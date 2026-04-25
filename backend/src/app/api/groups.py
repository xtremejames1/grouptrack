from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..db import session_scope
from ..models.group import Group
from ..models.habit import Habit
from ..services.checkins import apply_default_habits, validate_threshold, verify_session_token

router = APIRouter(prefix="/api/groups", tags=["groups"])


def _authorized_user(headers) -> str | None:
    token = headers.get("authorization", "")
    if token.lower().startswith("bearer "):
        token = token[7:]
    return verify_session_token(token or headers.get("x-session-token"))


@router.get("/{group_id}")
def get_group(group_id: str) -> dict:
    with session_scope() as session:
        group = session.get(Group, group_id)
        if group is None:
            raise HTTPException(404, "GROUP_NOT_FOUND")
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
        return {"habit": serialize_habit(habit)}


@router.delete("/{group_id}/habits/{habit_id}")
def remove_habit(group_id: str, habit_id: str) -> dict:
    with session_scope() as session:
        habit = session.get(Habit, habit_id)
        if habit is None or habit.group_id != group_id:
            raise HTTPException(404, "HABIT_NOT_FOUND")
        habit.active = False
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
    return {"id": habit.id, "groupId": habit.group_id, "slug": habit.slug, "label": habit.label, "active": habit.active}
