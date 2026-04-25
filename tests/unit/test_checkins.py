from __future__ import annotations

import os
from pathlib import Path

from app.db import ensure_schema, session_scope  # noqa: E402
from app.db.seed import DEFAULT_INVITE_CODE  # noqa: E402
from app.models.group import Group  # noqa: E402
from app.models.habit import Habit  # noqa: E402
from app.models.membership import Membership  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.checkins import apply_default_habits, record_checkin, sign_session_token  # noqa: E402


def setup_function() -> None:
    os.environ["DATABASE_URL"] = "sqlite:///./test.db"
    os.environ["SESSION_SIGNING_KEY"] = "test-key"
    os.environ["SEED_DEMO"] = "false"
    db = Path("test.db")
    if db.exists():
        db.unlink()
    ensure_schema()


def test_ensure_schema_respects_database_url_switch(tmp_path, monkeypatch) -> None:
    first_db = tmp_path / "first.db"
    second_db = tmp_path / "second.db"

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{first_db}")
    ensure_schema()
    assert first_db.exists()

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{second_db}")
    ensure_schema()
    assert second_db.exists()


def test_duplicate_checkin_is_idempotent() -> None:
    with session_scope() as session:
        group = Group(id="g1", name="Crew", invite_code=DEFAULT_INVITE_CODE, completion_threshold_n=1, nudges_enabled=False)
        user = User(id="u1", display_name="Ada", session_token=sign_session_token("u1"))
        session.add_all([group, user, Membership(id="m1", group_id="g1", user_id="u1")])
        apply_default_habits(session, "g1")
        habit = session.query(Habit).filter_by(group_id="g1", slug="sleep_7h").one()

        first = record_checkin(session, "u1", "g1", habit.id, "2026-04-25", "11111111-1111-1111-1111-111111111111")
        second = record_checkin(session, "u1", "g1", habit.id, "2026-04-25", "11111111-1111-1111-1111-111111111111")

        assert first.idempotent is False
        assert second.idempotent is True
        assert first.checkin.id == second.checkin.id
