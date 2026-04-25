from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request, Response
from sqlalchemy import select

from ..db import session_scope
from ..events.publisher import Event, publisher
from ..models.group import Group
from ..models.habit import Habit
from ..models.membership import Membership
from ..models.user import User
from ..services.checkins import record_checkin, remove_checkin, verify_session_token
from ..services.heatmap import get_group_calendar, get_heatmap
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api", tags=["checkins"])


def session_user_id(request: Request) -> str | None:
    token = request.headers.get("authorization", "")
    if token.lower().startswith("bearer "):
        token = token[7:]
    return verify_session_token(token or request.headers.get("x-session-token"))


@router.post("/checkins")
async def create_checkin(request: Request, response: Response, payload: dict) -> dict:
    user_id = session_user_id(request)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")
    for field in ("groupId", "habitId", "day", "idempotencyKey"):
        if not payload.get(field):
            raise HTTPException(400, f"{field.upper()}_REQUIRED")
    try:
        with session_scope() as session:
            result = record_checkin(session, user_id, payload["groupId"], payload["habitId"], payload["day"], payload["idempotencyKey"])
            checkin_id = result.checkin.id
            group_id = result.checkin.group_id
            habit_id = result.checkin.habit_id
            day = result.checkin.day
            heatmap_version = result.heatmap_version
            idempotent = result.idempotent
        if idempotent:
            response.status_code = 200
        else:
            response.status_code = 201
            await publisher.publish(group_id, Event(groupId=group_id, habitId=habit_id, day=day, version=heatmap_version))
        return {"checkInId": checkin_id, "heatmapVersion": heatmap_version, "idempotent": idempotent}
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        message = str(exc)
        raise HTTPException(422 if "HABIT" in message else 404, message) from exc
    except ValueError as exc:
        code = str(exc)
        status = 422 if code in {"DISPLAY_NAME_INVALID", "DAY_INVALID", "DAY_IN_FUTURE", "THRESHOLD_OUT_OF_RANGE", "HABIT_INVALID_OR_INACTIVE", "HABIT_NOT_ACTIVE_ON_DAY"} else 400
        raise HTTPException(status, code) from exc


@router.delete("/checkins")
async def delete_checkin(request: Request, response: Response, payload: dict) -> dict:
    user_id = session_user_id(request)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")
    for field in ("groupId", "habitId", "day"):
        if not payload.get(field):
            raise HTTPException(400, f"{field.upper()}_REQUIRED")
    try:
        with session_scope() as session:
            result = remove_checkin(session, user_id, payload["groupId"], payload["habitId"], payload["day"])
        if result.removed:
            await publisher.publish(
                payload["groupId"],
                Event(groupId=payload["groupId"], habitId=payload["habitId"], day=payload["day"], version=result.heatmap_version),
            )
            response.status_code = 200
        else:
            response.status_code = 200
        return {"removed": result.removed, "heatmapVersion": result.heatmap_version}
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/groups/{group_id}/heatmap")
def heatmap(
    group_id: str,
    request: Request,
    scope: str = "group",
    habitId: str | None = None,
    startDay: str | None = None,
    endDay: str | None = None,
) -> dict:
    user_id = session_user_id(request)
    if habitId is None:
        raise HTTPException(400, "HABIT_ID_REQUIRED")
    with session_scope() as session:
        if scope == "me" and not user_id:
            raise HTTPException(401, "UNAUTHORIZED")
        try:
            cells, version = get_heatmap(session, group_id, scope, habitId, user_id, startDay, endDay)
            return {"cells": cells, "version": version}
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc


@router.get("/groups/{group_id}/events")
async def events(group_id: str):
    queue = await publisher.subscribe(group_id)

    async def generator():
        try:
            while True:
                event = await queue.get()
                yield f"event: heatmap.updated\ndata: {{\"groupId\":\"{event.groupId}\",\"habitId\":\"{event.habitId}\",\"day\":\"{event.day}\",\"version\":{event.version}}}\n\n"
        finally:
            publisher.unsubscribe(group_id, queue)

    return StreamingResponse(generator(), media_type="text/event-stream")


@router.get("/groups/{group_id}/calendar")
def group_calendar(group_id: str, request: Request, startDay: str | None = None, endDay: str | None = None) -> dict:
    user_id = session_user_id(request)
    if not user_id:
        raise HTTPException(401, "UNAUTHORIZED")
    if not startDay or not endDay:
        raise HTTPException(400, "START_END_REQUIRED")

    with session_scope() as session:
        membership = session.execute(
            select(Membership.id).where(Membership.group_id == group_id, Membership.user_id == user_id)
        ).scalar_one_or_none()
        if membership is None:
            raise HTTPException(403, "NOT_GROUP_MEMBER")
        try:
            return get_group_calendar(session, group_id, startDay, endDay)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
