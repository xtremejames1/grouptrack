from __future__ import annotations

import hashlib
import hmac
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import Select, and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..models.checkin import CheckIn
from ..models.group import Group
from ..models.habit import Habit
from ..models.membership import Membership
from ..models.user import User

logger = logging.getLogger(__name__)
INVITE_RE = re.compile(r"^[A-Za-z0-9_-]{8,12}$")


def normalize_display_name(name: str) -> str:
    normalized = " ".join(name.replace("\x00", " ").split()).strip()
    if not (1 <= len(normalized) <= 50):
        raise ValueError("DISPLAY_NAME_INVALID")
    return normalized


def normalize_day(day_value: str) -> str:
    try:
        parsed = date.fromisoformat(day_value)
    except ValueError as exc:
        raise ValueError("DAY_INVALID") from exc
    if parsed > date.today():
        raise ValueError("DAY_IN_FUTURE")
    return parsed.isoformat()


def sign_session_token(user_id: str) -> str:
    payload = user_id.encode()
    sig = hmac.new(settings.session_signing_key.encode(), payload, hashlib.sha256).hexdigest()
    return f"{user_id}.{sig}"


def verify_session_token(token: str | None) -> str | None:
    if not token or "." not in token:
        return None
    user_id, sig = token.split(".", 1)
    expected = hmac.new(settings.session_signing_key.encode(), user_id.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(sig, expected):
        return user_id
    return None


def apply_default_habits(session: Session, group_id: str) -> list[Habit]:
    habits = []
    defaults = [
        ("sleep_7h", "Sleep 7h"),
        ("walk_30m", "Walk 30m"),
        ("read_20m", "Read 20m"),
    ]
    for slug, label in defaults:
        habit = session.execute(select(Habit).where(Habit.group_id == group_id, Habit.slug == slug)).scalar_one_or_none()
        if habit is None:
            habit = Habit(id=str(uuid.uuid5(uuid.NAMESPACE_URL, f"grouptrack:{group_id}:{slug}")), group_id=group_id, slug=slug, label=label, active=True)
            session.add(habit)
        else:
            habit.active = True  # restore if previously archived
        habits.append(habit)
    session.flush()
    return habits


def validate_threshold(threshold_n: int, active_member_count: int) -> None:
    if threshold_n < 1 or threshold_n > active_member_count:
        raise ValueError("THRESHOLD_OUT_OF_RANGE")


def is_completion_met(distinct_completed_members: int, threshold_n: int) -> bool:
    return distinct_completed_members >= threshold_n


@dataclass
class CheckInResult:
    checkin: CheckIn
    heatmap_version: int
    idempotent: bool


@dataclass
class RemoveCheckInResult:
    removed: bool
    heatmap_version: int


def record_checkin(session: Session, user_id: str, group_id: str, habit_id: str, day: str, idempotency_key: str) -> CheckInResult:
    day = normalize_day(day)
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", idempotency_key):
        raise ValueError("IDEMPOTENCY_KEY_INVALID")

    group = session.get(Group, group_id)
    if group is None:
        raise LookupError("GROUP_NOT_FOUND")

    membership = session.execute(select(Membership).where(Membership.group_id == group_id, Membership.user_id == user_id)).scalar_one_or_none()
    if membership is None:
        raise PermissionError("NOT_GROUP_MEMBER")

    habit = session.execute(select(Habit).where(Habit.id == habit_id, Habit.group_id == group_id, Habit.active.is_(True))).scalar_one_or_none()
    if habit is None:
        raise LookupError("HABIT_INVALID_OR_INACTIVE")

    active_member_count = session.execute(select(func.count(Membership.id)).where(Membership.group_id == group_id)).scalar_one()
    validate_threshold(group.completion_threshold_n, int(active_member_count))

    existing = session.execute(select(CheckIn).where(CheckIn.idempotency_key == idempotency_key)).scalar_one_or_none()
    if existing:
        logger.warning("checkin.idempotent_replay", extra={"idempotencyKey": idempotency_key, "userId": user_id})
        return CheckInResult(existing, heatmap_version=get_heatmap_version(session, group_id), idempotent=True)

    logical_existing = session.execute(
        select(CheckIn).where(
            CheckIn.group_id == group_id,
            CheckIn.habit_id == habit_id,
            CheckIn.user_id == user_id,
            CheckIn.day == day,
        )
    ).scalar_one_or_none()
    if logical_existing:
        return CheckInResult(logical_existing, heatmap_version=get_heatmap_version(session, group_id), idempotent=True)

    checkin = CheckIn(
        id=str(uuid.uuid4()),
        group_id=group_id,
        habit_id=habit_id,
        user_id=user_id,
        day=day,
        idempotency_key=idempotency_key,
        created_at=datetime.now(timezone.utc),
    )
    session.add(checkin)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        replay = session.execute(select(CheckIn).where(CheckIn.idempotency_key == idempotency_key)).scalar_one_or_none()
        if replay:
            return CheckInResult(replay, heatmap_version=get_heatmap_version(session, group_id), idempotent=True)
        raise exc

    current_version = get_heatmap_version(session, group_id)
    logger.info("checkin.recorded", extra={"groupId": group_id, "habitId": habit_id, "userId": user_id, "day": day, "version": current_version})
    return CheckInResult(checkin, heatmap_version=current_version, idempotent=False)


def get_heatmap_version(session: Session, group_id: str) -> int:
    return int(session.execute(select(func.count(CheckIn.id)).where(CheckIn.group_id == group_id)).scalar_one())


def remove_checkin(session: Session, user_id: str, group_id: str, habit_id: str, day: str) -> RemoveCheckInResult:
    day = normalize_day(day)

    group = session.get(Group, group_id)
    if group is None:
        raise LookupError("GROUP_NOT_FOUND")

    membership = session.execute(select(Membership).where(Membership.group_id == group_id, Membership.user_id == user_id)).scalar_one_or_none()
    if membership is None:
        raise PermissionError("NOT_GROUP_MEMBER")

    habit = session.execute(select(Habit).where(Habit.id == habit_id, Habit.group_id == group_id)).scalar_one_or_none()
    if habit is None:
        raise LookupError("HABIT_NOT_FOUND")

    existing = session.execute(
        select(CheckIn).where(
            CheckIn.group_id == group_id,
            CheckIn.habit_id == habit_id,
            CheckIn.user_id == user_id,
            CheckIn.day == day,
        )
    ).scalar_one_or_none()

    if existing is None:
        return RemoveCheckInResult(removed=False, heatmap_version=get_heatmap_version(session, group_id))

    session.delete(existing)
    session.flush()
    return RemoveCheckInResult(removed=True, heatmap_version=get_heatmap_version(session, group_id))
