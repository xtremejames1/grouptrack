from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import and_, func, select
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
    habit = session.get(Habit, habit_id)
    if habit is None or habit.group_id != group_id:
        raise ValueError("HABIT_INVALID_OR_INACTIVE")
    habit_start_day = habit.created_at.date().isoformat()
    day_buckets = {day: 0 for day in days}

    query = select(CheckIn.day, func.count(CheckIn.id))
    query = query.where(CheckIn.group_id == group_id, CheckIn.habit_id == habit_id)
    if scope == "me" and user_id:
        query = query.where(CheckIn.user_id == user_id)
    query = query.group_by(CheckIn.day)
    rows = session.execute(query).all()
    for day, count in rows:
        day_buckets[str(day)] = int(count)

    cells = []
    for day, count in day_buckets.items():
        is_trackable = day >= habit_start_day
        cells.append({"day": day, "count": count if is_trackable else 0, "intensity": intensity_for(count) if is_trackable else 0, "isTrackable": is_trackable})
    version = session.execute(select(func.count(CheckIn.id)).where(CheckIn.group_id == group_id)).scalar_one()
    return cells, int(version)


def _intensity_for_percent(percent: int) -> int:
    if percent <= 0:
        return 0
    if percent < 25:
        return 1
    if percent < 50:
        return 2
    if percent < 75:
        return 3
    return 4


def get_group_calendar(session: Session, group_id: str, start_day: str, end_day: str) -> dict:
    days = day_range(start_day=start_day, end_day=end_day)

    members = session.execute(
        select(User.id, User.display_name)
        .select_from(Membership)
        .join(User, User.id == Membership.user_id)
        .where(Membership.group_id == group_id)
        .order_by(User.display_name.asc())
    ).all()
    member_payload = [{"id": member_id, "displayName": display_name} for member_id, display_name in members]
    member_count = len(member_payload)

    habits = session.execute(
        select(Habit.id, Habit.label, Habit.created_at)
        .where(and_(Habit.group_id == group_id, Habit.active.is_(True)))
        .order_by(Habit.created_at.asc())
    ).all()
    habit_ids = [habit_id for habit_id, _label, _created_at in habits]
    habit_start_days = {habit_id: created_at.date().isoformat() for habit_id, _label, created_at in habits}

    completed_by_day_habit: dict[str, dict[str, set[str]]] = {
        day: {habit_id: set() for habit_id in habit_ids} for day in days
    }

    if habit_ids and member_count:
        rows = session.execute(
            select(CheckIn.day, CheckIn.habit_id, CheckIn.user_id)
            .where(
                CheckIn.group_id == group_id,
                CheckIn.day >= days[0],
                CheckIn.day <= days[-1],
                CheckIn.habit_id.in_(habit_ids),
            )
        ).all()
        for day, habit_id, user_id in rows:
            day_str = str(day)
            if day_str in completed_by_day_habit and habit_id in completed_by_day_habit[day_str]:
                completed_by_day_habit[day_str][habit_id].add(user_id)

    calendar_days = []
    for day in days:
        habit_payload = []
        for habit_id in habit_ids:
            is_trackable = day >= habit_start_days[habit_id]
            completed_ids = sorted(completed_by_day_habit[day][habit_id]) if is_trackable else []
            completed_count = len(completed_ids) if is_trackable else 0
            percent_complete = int(round((completed_count / member_count) * 100)) if member_count and is_trackable else 0
            habit_payload.append(
                {
                    "habitId": habit_id,
                    "completedCount": completed_count,
                    "memberCount": member_count,
                    "percentComplete": percent_complete,
                    "intensity": _intensity_for_percent(percent_complete),
                    "completedUserIds": completed_ids,
                    "isTrackable": is_trackable,
                }
            )
        calendar_days.append({"day": day, "habits": habit_payload})

    return {"days": calendar_days, "members": member_payload}
