from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..db import session_scope
from ..models.group import Group
from ..models.membership import Membership
from ..models.user import User
from ..schemas import JoinRequest, JoinResponse
from ..services.checkins import normalize_display_name, sign_session_token, apply_default_habits

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/invites", tags=["invites"])


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


def serialize_group(group: Group) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "inviteCode": group.invite_code,
        "completionThresholdN": group.completion_threshold_n,
        "nudgesEnabled": group.nudges_enabled,
        "createdAt": group.created_at.isoformat(),
    }
