from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from ..db import engine

router = APIRouter()


@router.get("/health")
def health() -> dict:
    with engine.begin() as conn:
        conn.execute(text("SELECT 1"))
        version = conn.execute(text("SELECT COALESCE(MAX(version), 0) FROM schema_version")).scalar_one()
    return {"ok": True, "schemaVersion": int(version)}
