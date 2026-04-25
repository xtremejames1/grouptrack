from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import re

import httpx
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models.checkin import CheckIn
from ..models.habit import Habit
from ..models.membership import Membership
from ..models.user import User

MESSAGE_TYPES = {"nudge", "celebrate", "achievement"}
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass
class SocialContext:
    target_name: str
    total_habits: int
    target_completed_count: int
    group_member_count: int
    group_fully_done_count: int
    group_any_done_count: int
    max_streak: int


def normalize_message(text: str) -> str:
    normalized = _WHITESPACE_RE.sub(" ", (text or "").replace("\x00", " ")).strip()
    if not normalized:
        raise ValueError("MESSAGE_REQUIRED")
    if len(normalized) > 280:
        raise ValueError("MESSAGE_TOO_LONG")
    return normalized


def _parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("DAY_INVALID") from exc


def _streak_for_habit_days(days: set[str], through_day: str) -> int:
    if not days:
        return 0
    cursor = date.fromisoformat(through_day)
    streak = 0
    while cursor.isoformat() in days:
        streak += 1
        cursor = cursor.fromordinal(cursor.toordinal() - 1)
    return streak


def compute_social_context(session: Session, group_id: str, target_user_id: str, day: str) -> SocialContext:
    parsed_day = _parse_day(day)
    day_iso = parsed_day.isoformat()
    target = session.get(User, target_user_id)
    if target is None:
        raise LookupError("USER_NOT_FOUND")

    habits = session.execute(
        select(Habit.id)
        .where(and_(Habit.group_id == group_id, Habit.active.is_(True), func.date(Habit.created_at) <= parsed_day))
    ).all()
    habit_ids = [habit_id for habit_id, in habits]
    total_habits = len(habit_ids)

    members = session.execute(select(Membership.user_id).where(Membership.group_id == group_id)).all()
    member_ids = [member_id for member_id, in members]

    if not habit_ids or not member_ids:
        return SocialContext(
            target_name=target.display_name,
            total_habits=total_habits,
            target_completed_count=0,
            group_member_count=len(member_ids),
            group_fully_done_count=0,
            group_any_done_count=0,
            max_streak=0,
        )

    rows = session.execute(
        select(CheckIn.user_id, CheckIn.habit_id, CheckIn.day)
        .where(CheckIn.group_id == group_id, CheckIn.day == day_iso, CheckIn.habit_id.in_(habit_ids))
    ).all()
    completed_map: dict[str, set[str]] = {member_id: set() for member_id in member_ids}
    for user_id, habit_id, _ in rows:
        if user_id in completed_map:
            completed_map[user_id].add(habit_id)

    target_completed_count = len(completed_map.get(target_user_id, set()))
    group_any_done_count = sum(1 for habit_set in completed_map.values() if habit_set)
    group_fully_done_count = sum(1 for habit_set in completed_map.values() if len(habit_set) == total_habits)

    streak_rows = session.execute(
        select(CheckIn.day)
        .where(
            CheckIn.group_id == group_id,
            CheckIn.user_id == target_user_id,
            CheckIn.habit_id.in_(habit_ids),
            CheckIn.day <= day_iso,
        )
        .group_by(CheckIn.day)
        .having(func.count(func.distinct(CheckIn.habit_id)) == total_habits)
        .order_by(CheckIn.day.desc())
        .limit(60)
    ).all()
    streak_days = {value for value, in streak_rows}
    max_streak = _streak_for_habit_days(streak_days, day_iso)

    return SocialContext(
        target_name=target.display_name,
        total_habits=total_habits,
        target_completed_count=target_completed_count,
        group_member_count=len(member_ids),
        group_fully_done_count=group_fully_done_count,
        group_any_done_count=group_any_done_count,
        max_streak=max_streak,
    )


def _fallback_message(message_type: str, context: SocialContext) -> str:
    if message_type == "achievement":
        streak_part = f" {context.max_streak} day streak and counting!" if context.max_streak > 1 else ""
        return (
            f"Just completed {context.target_completed_count}/{context.total_habits} habits today!{streak_part} 🏆"
        )
    if message_type == "celebrate":
        return (
            f"{context.target_name}, you completed {context.target_completed_count} of "
            f"{context.total_habits} habits today. Huge win! 🎉"
        )
    return (
        f"{context.target_name}, your group showed up today. "
        "A quick 10 minutes gets you back in."
    )


def _build_prompt(message_type: str, context: SocialContext) -> str:
    if message_type not in MESSAGE_TYPES:
        raise ValueError("MESSAGE_TYPE_INVALID")
    if message_type == "achievement":
        return (
            "Write exactly one first-person achievement post for a habit tracking app.\n"
            "Rules:\n"
            "- Write in first person (I, my).\n"
            "- Keep it short and celebratory.\n"
            "- 8 to 20 words.\n"
            "- Positive and energetic tone.\n"
            "- Include 1-2 relevant emoji.\n"
            "- Return only the message text.\n\n"
            f"My name: {context.target_name}\n"
            f"Habits I completed today: {context.target_completed_count} of {context.total_habits}\n"
            f"My current streak: {context.max_streak} days\n"
            f"Group members who also completed all habits today: {context.group_fully_done_count}\n"
        )
    action = "Celebrate their progress" if message_type == "celebrate" else "Nudge them gently"
    return (
        "Write exactly one supportive message for a habit app.\n"
        "Rules:\n"
        "- Keep it short and positive.\n"
        "- 8 to 20 words.\n"
        "- No guilt, shame, pressure, or negative framing.\n"
        "- No emoji unless this is a celebrate message.\n"
        "- Use the target name exactly as provided.\n"
        "- Return only the message text.\n\n"
        f"Action: {action}\n"
        f"Target name: {context.target_name}\n"
        f"Target completed habits today: {context.target_completed_count}\n"
        f"Total active habits today: {context.total_habits}\n"
        f"Group members: {context.group_member_count}\n"
        f"Group members with at least one habit done today: {context.group_any_done_count}\n"
        f"Group members with all habits done today: {context.group_fully_done_count}\n"
        f"Target current streak of fully completed days: {context.max_streak}\n"
    )


def _validate_personal_note(note: str, context: SocialContext) -> str:
    """Ensures a personal note added to an achievement post makes no false numerical claims."""
    if not settings.anthropic_api_key:
        return note
    prompt = (
        "A user added this personal note to their habit achievement post:\n"
        f'"{note}"\n\n'
        "Their verified data:\n"
        f"- Habits completed today: {context.target_completed_count} of {context.total_habits}\n"
        f"- Current streak: {context.max_streak} consecutive days\n\n"
        "Instructions:\n"
        "- If the note makes any false numerical claims about habits or streaks, correct them.\n"
        "- Personal feelings and general enthusiasm without specific numbers are fine as-is.\n"
        "- Keep it under 20 words.\n"
        "- Return ONLY the note text, nothing else.\n"
    )
    try:
        with httpx.Client(timeout=settings.anthropic_timeout_seconds) as client:
            response = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": settings.anthropic_model,
                    "max_tokens": 80,
                    "temperature": 0.2,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            blocks = response.json().get("content", [])
            text = " ".join(b.get("text", "") for b in blocks if b.get("type") == "text")
            return normalize_message(text)
    except Exception:
        return note


def build_achievement_body(session: Session, group_id: str, user_id: str, day: str, personal_note: str) -> str:
    """Generates a factual achievement summary from real data and appends a validated personal note."""
    factual = generate_social_message(session, group_id, user_id, day, "achievement")
    if not personal_note.strip():
        return factual
    context = compute_social_context(session, group_id, user_id, day)
    validated_note = _validate_personal_note(personal_note.strip(), context)
    return f"{factual} — {validated_note}"


def generate_social_message(session: Session, group_id: str, target_user_id: str, day: str, message_type: str) -> str:
    context = compute_social_context(session, group_id, target_user_id, day)
    fallback = _fallback_message(message_type, context)
    if not settings.anthropic_api_key:
        return fallback

    try:
        with httpx.Client(timeout=settings.anthropic_timeout_seconds) as client:
            response = client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": settings.anthropic_model,
                    "max_tokens": 120,
                    "temperature": 0.6,
                    "messages": [{"role": "user", "content": _build_prompt(message_type, context)}],
                },
            )
            response.raise_for_status()
            payload = response.json()
            blocks = payload.get("content", [])
            text_blocks = [block.get("text", "") for block in blocks if block.get("type") == "text"]
            candidate = normalize_message(" ".join(text_blocks))
            if message_type == "nudge":
                candidate = candidate.replace("🎉", "").strip()
            return candidate
    except Exception:
        return fallback
