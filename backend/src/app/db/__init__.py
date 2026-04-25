from __future__ import annotations

from contextlib import contextmanager
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from ..config import settings


Base = declarative_base()

_engine = None
_engine_url: str | None = None
SessionLocal = None


def _current_database_url() -> str:
    return os.getenv("DATABASE_URL", settings.database_url)


def _configure_engine() -> None:
    global _engine, _engine_url, SessionLocal
    database_url = _current_database_url()
    if _engine is not None and _engine_url == database_url:
        return
    if _engine is not None:
        _engine.dispose()
    _engine = create_engine(
        database_url,
        future=True,
        pool_pre_ping=True,
        connect_args={"check_same_thread": False} if database_url.startswith("sqlite") else {},
    )
    SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
    _engine_url = database_url


def _engine_instance():
    _configure_engine()
    assert _engine is not None
    return _engine


def _session_factory():
    _configure_engine()
    assert SessionLocal is not None
    return SessionLocal


class _EngineProxy:
    def __getattr__(self, item):
        return getattr(_engine_instance(), item)


engine = _EngineProxy()


@contextmanager
def session_scope() -> Session:
    session = _session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ensure_schema() -> None:
    from ..models import checkin, group, habit, membership, reminder_run, schema_version, social_message, user  # noqa: F401

    engine = _engine_instance()
    engine.dispose()
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        current = conn.execute(text("SELECT COALESCE(MAX(version), 0) FROM schema_version")).scalar_one()
        if current < 1:
            conn.execute(text("INSERT INTO schema_version (version, applied_at) VALUES (1, CURRENT_TIMESTAMP)"))
