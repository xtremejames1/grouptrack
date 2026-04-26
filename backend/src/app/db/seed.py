from __future__ import annotations

import uuid

from sqlalchemy import select

from ..config import settings
from ..models.group import Group
from ..services.checkins import apply_default_habits
from ..db import session_scope


DEFAULT_INVITE_CODE = "DEMO2026"


def seed_demo_data() -> None:
    with session_scope() as session:
        group = session.execute(select(Group).where(Group.invite_code == DEFAULT_INVITE_CODE)).scalar_one_or_none()
        if group is None:
            group = Group(id=str(uuid.uuid4()), name="Hackathon Crew", invite_code=DEFAULT_INVITE_CODE, completion_threshold_n=settings.completion_threshold_n, nudges_enabled=False)
            session.add(group)
            session.flush()
        apply_default_habits(session, group.id)
