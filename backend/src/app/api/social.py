from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import desc, select

from ..db import session_scope
from ..models.membership import Membership
from ..models.social_message import SocialMessage
from ..models.social_message_kudos import SocialMessageKudos
from ..models.user import User
from ..services.checkins import normalize_day, verify_session_token
from ..services.social import MESSAGE_TYPES, build_achievement_body, generate_social_message, normalize_message

router = APIRouter(prefix="/api/groups", tags=["social"])


def _authorized_user(headers) -> str | None:
    token = headers.get("authorization", "")
    if token.lower().startswith("bearer "):
        token = token[7:]
    return verify_session_token(token or headers.get("x-session-token"))


def _require_membership(session, group_id: str, user_id: str) -> None:
    membership = session.execute(
        select(Membership.id).where(Membership.group_id == group_id, Membership.user_id == user_id)
    ).scalar_one_or_none()
    if membership is None:
        raise HTTPException(403, "NOT_GROUP_MEMBER")


@router.get("/{group_id}/social-messages")
def list_social_messages(group_id: str, request: Request, limit: int = 30) -> dict:
    user_id = _authorized_user(request.headers)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")

    with session_scope() as session:
        _require_membership(session, group_id, user_id)
        capped_limit = max(1, min(limit, 100))
        rows = session.execute(
            select(SocialMessage, User.display_name)
            .join(User, User.id == SocialMessage.sender_user_id)
            .where(SocialMessage.group_id == group_id)
            .order_by(desc(SocialMessage.created_at))
            .limit(capped_limit)
        ).all()
        message_ids = [message.id for message, _ in rows]
        kudos_rows = []
        if message_ids:
            kudos_rows = session.execute(
                select(SocialMessageKudos.social_message_id, SocialMessageKudos.user_id)
                .where(SocialMessageKudos.social_message_id.in_(message_ids))
            ).all()
        kudos_by_message: dict[str, set[str]] = {}
        for social_message_id, kudos_user_id in kudos_rows:
            kudos_by_message.setdefault(social_message_id, set()).add(kudos_user_id)

        users = session.execute(
            select(User.id, User.display_name)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.group_id == group_id)
        ).all()
        names_by_id = {user_id_value: name for user_id_value, name in users}

        return {
            "messages": [
                {
                    "id": message.id,
                    "groupId": message.group_id,
                    "senderUserId": message.sender_user_id,
                    "senderName": sender_name,
                    "targetUserId": message.target_user_id,
                    "targetName": names_by_id.get(message.target_user_id, "Unknown"),
                    "day": message.day,
                    "messageType": message.message_type,
                    "body": message.body,
                    "createdAt": message.created_at.isoformat(),
                    "congratsCount": len(kudos_by_message.get(message.id, set())),
                    "congratsByMe": user_id in kudos_by_message.get(message.id, set()),
                }
                for message, sender_name in rows
            ]
        }


@router.post("/{group_id}/social-messages/preview")
def preview_social_message(group_id: str, request: Request, payload: dict) -> dict:
    user_id = _authorized_user(request.headers)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")

    target_user_id = str(payload.get("targetUserId") or "")
    message_type = str(payload.get("messageType") or "")
    day = normalize_day(str(payload.get("day") or ""))
    if not target_user_id:
        raise HTTPException(400, "TARGET_USER_REQUIRED")
    if message_type not in MESSAGE_TYPES:
        raise HTTPException(422, "MESSAGE_TYPE_INVALID")

    with session_scope() as session:
        _require_membership(session, group_id, user_id)
        _require_membership(session, group_id, target_user_id)
        suggested = generate_social_message(session, group_id, target_user_id, day, message_type)
        return {"message": suggested}


@router.post("/{group_id}/social-messages")
def create_social_message(group_id: str, request: Request, payload: dict) -> dict:
    user_id = _authorized_user(request.headers)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")

    target_user_id = str(payload.get("targetUserId") or "")
    message_type = str(payload.get("messageType") or "")
    day = normalize_day(str(payload.get("day") or ""))
    # For achievements the submitted body is an optional personal note, not the full post
    personal_note = str(payload.get("body") or "").strip()
    if message_type != "achievement":
        body = normalize_message(personal_note)
    if not target_user_id:
        raise HTTPException(400, "TARGET_USER_REQUIRED")
    if message_type not in MESSAGE_TYPES:
        raise HTTPException(422, "MESSAGE_TYPE_INVALID")

    with session_scope() as session:
        _require_membership(session, group_id, user_id)
        _require_membership(session, group_id, target_user_id)
        if message_type == "achievement":
            # Always generate factual summary from real data; personal note is appended and validated
            body = build_achievement_body(session, group_id, user_id, day, personal_note)
        message = SocialMessage(
            group_id=group_id,
            sender_user_id=user_id,
            target_user_id=target_user_id,
            day=day,
            message_type=message_type,
            body=body,
        )
        session.add(message)
        session.flush()

        sender_name = session.get(User, user_id).display_name
        target_name = session.get(User, target_user_id).display_name
        return {
            "message": {
                "id": message.id,
                "groupId": message.group_id,
                "senderUserId": message.sender_user_id,
                "senderName": sender_name,
                "targetUserId": message.target_user_id,
                "targetName": target_name,
                "day": message.day,
                "messageType": message.message_type,
                "body": message.body,
                "createdAt": message.created_at.isoformat(),
                "congratsCount": 0,
                "congratsByMe": False,
            }
        }


@router.post("/{group_id}/social-messages/{message_id}/congratulate")
def congratulate_social_message(group_id: str, message_id: str, request: Request) -> dict:
    user_id = _authorized_user(request.headers)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")

    with session_scope() as session:
        _require_membership(session, group_id, user_id)
        message = session.execute(
            select(SocialMessage).where(SocialMessage.id == message_id, SocialMessage.group_id == group_id)
        ).scalar_one_or_none()
        if message is None:
            raise HTTPException(404, "SOCIAL_MESSAGE_NOT_FOUND")
        if message.message_type != "achievement":
            raise HTTPException(422, "CONGRATS_ONLY_FOR_ACHIEVEMENT")

        existing = session.execute(
            select(SocialMessageKudos.id).where(
                SocialMessageKudos.social_message_id == message_id, SocialMessageKudos.user_id == user_id
            )
        ).scalar_one_or_none()
        if existing is None:
            session.add(SocialMessageKudos(social_message_id=message_id, user_id=user_id))
            session.flush()

        kudos_count = session.execute(
            select(SocialMessageKudos.user_id).where(SocialMessageKudos.social_message_id == message_id)
        ).all()
        return {
            "messageId": message_id,
            "congratsCount": len(kudos_count),
            "congratsByMe": True,
        }
