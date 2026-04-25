from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models.group import Group
from ..models.reminder_run import ReminderRun

logger = logging.getLogger(__name__)


def run_reminder_stub(session: Session) -> list[dict]:
    logger.info("reminders.stub.disabled", extra={"enabled": settings.nudges_automation_enabled})
    if not settings.nudges_automation_enabled:
        return []

    runs: list[dict] = []
    for group in session.execute(select(Group)).scalars().all():
        try:
            run = ReminderRun(
                id=f"rem_{group.id}",
                group_id=group.id,
                eligible_member_count=0,
                reminder_candidate_count=0,
                enabled=True,
            )
            session.add(run)
            session.flush()
            runs.append({
                "groupId": group.id,
                "evaluatedAt": run.evaluated_at.isoformat(),
                "eligibleMemberCount": 0,
                "reminderCandidateCount": 0,
                "enabled": True,
            })
        except Exception as exc:  # pragma: no cover - defensive stub
            logger.warning("reminders.stub.failed", extra={"groupId": group.id, "error": str(exc)})
    return runs
