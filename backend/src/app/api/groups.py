from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..db import session_scope
from ..models.checkin import CheckIn
from ..models.group import Group
from ..models.habit import Habit
from ..models.membership import Membership
from ..services.checkins import apply_default_habits, validate_threshold, verify_session_token

router = APIRouter(prefix="/api/groups", tags=["groups"])


def _authorized_user(headers) -> str | None:
    token = headers.get("authorization", "")
    if token.lower().startswith("bearer "):
        token = token[7:]
    return verify_session_token(token or headers.get("x-session-token"))


@router.get("/{group_id}")
def get_group(group_id: str, request: Request) -> dict:
    user_id = _authorized_user(request.headers)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")
    with session_scope() as session:
        group = session.get(Group, group_id)
        if group is None:
            raise HTTPException(404, "GROUP_NOT_FOUND")
        membership = session.execute(
            select(Membership.id).where(Membership.group_id == group_id, Membership.user_id == user_id)
        ).scalar_one_or_none()
        if membership is None:
            raise HTTPException(403, "NOT_GROUP_MEMBER")
        habits = session.execute(select(Habit).where(Habit.group_id == group_id)).scalars().all()
        return {"group": serialize_group(group), "habits": [serialize_habit(h) for h in habits]}


@router.post("/{group_id}/habit-pack/apply")
def apply_pack(group_id: str) -> dict:
    with session_scope() as session:
        group = session.get(Group, group_id)
        if group is None:
            raise HTTPException(404, "GROUP_NOT_FOUND")
        habits = apply_default_habits(session, group_id)
        return {"habits": [serialize_habit(h) for h in habits]}


@router.post("/{group_id}/habits")
def add_habit(group_id: str, payload: dict) -> dict:
    with session_scope() as session:
        group = session.get(Group, group_id)
        if group is None:
            raise HTTPException(404, "GROUP_NOT_FOUND")
        habit = Habit(group_id=group_id, slug=payload["slug"], label=payload["label"], active=True)
        session.add(habit)
        try:
            session.flush()
        except IntegrityError as exc:
            raise HTTPException(409, "HABIT_SLUG_CONFLICT") from exc
        return {"habit": serialize_habit(habit)}


@router.delete("/{group_id}/habits/{habit_id}")
def remove_habit(group_id: str, habit_id: str) -> dict:
    with session_scope() as session:
        habit = session.get(Habit, habit_id)
        if habit is None or habit.group_id != group_id:
            raise HTTPException(404, "HABIT_NOT_FOUND")
        habit.active = False
        return {"ok": True}


@router.post("/{group_id}/habits/{habit_id}/restore")
def restore_habit(group_id: str, habit_id: str) -> dict:
    with session_scope() as session:
        habit = session.get(Habit, habit_id)
        if habit is None or habit.group_id != group_id:
            raise HTTPException(404, "HABIT_NOT_FOUND")
        habit.active = True
        return {"habit": serialize_habit(habit)}


@router.delete("/{group_id}/members/me")
def leave_group(group_id: str, request: Request) -> dict:
    user_id = _authorized_user(request.headers)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")
    with session_scope() as session:
        group = session.get(Group, group_id)
        if group is None:
            raise HTTPException(404, "GROUP_NOT_FOUND")
        membership = session.execute(
            select(Membership).where(Membership.group_id == group_id, Membership.user_id == user_id)
        ).scalar_one_or_none()
        if membership is None:
            raise HTTPException(404, "MEMBERSHIP_NOT_FOUND")
        session.delete(membership)
        session.query(CheckIn).filter(CheckIn.group_id == group_id, CheckIn.user_id == user_id).delete()
        remaining_members = session.execute(
            select(Membership.id).where(Membership.group_id == group_id)
        ).all()
        if not remaining_members:
            session.delete(group)
        return {"ok": True}


def serialize_group(group: Group) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "inviteCode": group.invite_code,
        "completionThresholdN": group.completion_threshold_n,
        "nudgesEnabled": group.nudges_enabled,
        "createdAt": group.created_at.isoformat(),
    }


def serialize_habit(habit: Habit) -> dict:
    return {
        "id": habit.id,
        "groupId": habit.group_id,
        "slug": habit.slug,
        "label": habit.label,
        "active": habit.active,
        "createdAt": habit.created_at.isoformat(),
    }
