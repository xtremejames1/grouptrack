from __future__ import annotations

import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./threshold.db"
os.environ["SESSION_SIGNING_KEY"] = "test-key"
os.environ["SEED_DEMO"] = "false"

from app.db import ensure_schema, session_scope  # noqa: E402
from app.models.group import Group  # noqa: E402
from app.models.membership import Membership  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.checkins import is_completion_met, validate_threshold  # noqa: E402


def setup_function() -> None:
    db = Path("threshold.db")
    if db.exists():
        db.unlink()
    ensure_schema()


def test_threshold_validation_rules() -> None:
    validate_threshold(1, 1)
    validate_threshold(2, 2)
    try:
        validate_threshold(0, 1)
        assert False
    except ValueError:
        pass


def test_completion_threshold_semantics() -> None:
    assert is_completion_met(0, 1) is False
    assert is_completion_met(1, 1) is True
    assert is_completion_met(1, 2) is False
    assert is_completion_met(2, 2) is True
    assert is_completion_met(3, 2) is True
    try:
        validate_threshold(3, 2)
        assert False
    except ValueError:
        pass
