from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models.checkin import CheckIn
from ..models.habit import Habit
from ..models.membership import Membership
from ..models.user import User


def intensity_for(count: int) -> int:
    if count <= 0:
        return 0
    if count == 1:
        return 1
    if count == 2:
        return 2
    if count == 3:
        return 3
    return 4


def _parse_day(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field.upper()}_INVALID") from exc


def day_range(days: int = 14, start_day: str | None = None, end_day: str | None = None) -> list[str]:
    if start_day is None and end_day is None:
        end = date.today()
        return [(end - timedelta(days=offset)).isoformat() for offset in range(days - 1, -1, -1)]

    if not start_day or not end_day:
        raise ValueError("HEATMAP_RANGE_INVALID")

    start = _parse_day(start_day, "startDay")
    end = _parse_day(end_day, "endDay")
    if end < start:
        raise ValueError("HEATMAP_RANGE_INVALID")
    if (end - start).days > 124:
        raise ValueError("HEATMAP_RANGE_TOO_LARGE")

    return [(start + timedelta(days=offset)).isoformat() for offset in range((end - start).days + 1)]


def get_heatmap(
    session: Session,
    group_id: str,
    scope: str,
    habit_id: str,
    user_id: str | None = None,
    start_day: str | None = None,
    end_day: str | None = None,
) -> tuple[list[dict], int]:
    days = day_range(start_day=start_day, end_day=end_day)
    day_buckets = {day: 0 for day in days}

    query = select(CheckIn.day, func.count(CheckIn.id))
    query = query.where(CheckIn.group_id == group_id, CheckIn.habit_id == habit_id)
    if scope == "me" and user_id:
        query = query.where(CheckIn.user_id == user_id)
    query = query.group_by(CheckIn.day)
    rows = session.execute(query).all()
    for day, count in rows:
        day_buckets[str(day)] = int(count)

    cells = [
        {"day": day, "count": count, "intensity": intensity_for(count)}
        for day, count in day_buckets.items()
    ]
    version = session.execute(select(func.count(CheckIn.id)).where(CheckIn.group_id == group_id)).scalar_one()
    return cells, int(version)
