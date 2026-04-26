from __future__ import annotations

import logging
import random
import string

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..config import settings
from ..db import session_scope
from ..models.group import Group
from ..models.membership import Membership
from ..models.user import User
from ..services.checkins import normalize_display_name, sign_session_token, apply_default_habits

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/invites", tags=["invites"])


def _new_invite_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(8))


def _normalize_group_name(value: str) -> str:
    normalized = " ".join((value or "").replace("\x00", " ").split()).strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="GROUP_NAME_REQUIRED")
    if len(normalized) > 80:
        raise HTTPException(status_code=422, detail="GROUP_NAME_TOO_LONG")
    return normalized


@router.post("/{invite_code}/join", status_code=201)
def join(invite_code: str, payload: dict) -> dict:
    display_name = normalize_display_name(payload.get("displayName", ""))
    with session_scope() as session:
        group = session.execute(select(Group).where(Group.invite_code == invite_code)).scalar_one_or_none()
        if group is None:
            raise HTTPException(status_code=404, detail="INVITE_NOT_FOUND")
        user = User(display_name=display_name, session_token="")
        session.add(user)
        session.flush()
        user.session_token = sign_session_token(user.id)
        session.add(Membership(group_id=group.id, user_id=user.id))
        apply_default_habits(session, group.id)
        logger.info("invite.join.success", extra={"groupId": group.id, "userId": user.id})
        return {"user": {"id": user.id, "displayName": user.display_name, "createdAt": user.created_at.isoformat()}, "group": serialize_group(group), "sessionToken": user.session_token}


@router.post("/create", status_code=201)
def create_group(payload: dict) -> dict:
    display_name = normalize_display_name(payload.get("displayName", ""))
    group_name = _normalize_group_name(payload.get("groupName", ""))
    threshold = int(payload.get("completionThresholdN") or settings.completion_threshold_n)
    if threshold < 1 or threshold > 20:
        raise HTTPException(status_code=422, detail="THRESHOLD_OUT_OF_RANGE")
    with session_scope() as session:
        invite_code = _new_invite_code()
        while session.execute(select(Group.id).where(Group.invite_code == invite_code)).scalar_one_or_none():
            invite_code = _new_invite_code()
        group = Group(
            name=group_name,
            invite_code=invite_code,
            completion_threshold_n=threshold,
            nudges_enabled=False,
        )
        session.add(group)
        session.flush()
        user = User(display_name=display_name, session_token="")
        session.add(user)
        session.flush()
        user.session_token = sign_session_token(user.id)
        session.add(Membership(group_id=group.id, user_id=user.id))
        apply_default_habits(session, group.id)
        return {
            "user": {"id": user.id, "displayName": user.display_name, "createdAt": user.created_at.isoformat()},
            "group": serialize_group(group),
            "sessionToken": user.session_token,
        }


def serialize_group(group: Group) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "inviteCode": group.invite_code,
        "completionThresholdN": group.completion_threshold_n,
        "nudgesEnabled": group.nudges_enabled,
        "createdAt": group.created_at.isoformat(),
    }
