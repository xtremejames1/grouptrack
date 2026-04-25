from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.checkins import router as checkins_router
from .api.groups import router as groups_router
from .api.health import router as health_router
from .api.invites import router as invites_router
from .config import settings
from .db import ensure_schema, session_scope
from .db.seed import seed_demo_data
from .services.nudges import run_reminder_stub

logging.basicConfig(level=logging.INFO, format="%(message)s")

app = FastAPI(title="GroupTrack")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(health_router)
app.include_router(invites_router)
app.include_router(checkins_router)
app.include_router(groups_router)


@app.on_event("startup")
def startup() -> None:
    ensure_schema()
    if settings.seed_demo:
        seed_demo_data()
    with session_scope() as session:
        run_reminder_stub(session)
    logging.getLogger(__name__).info("app.startup", extra={"version": "0.1.0", "profile": settings.app_env})


@app.get("/")
def root() -> dict:
    return {"ok": True, "service": "grouptrack"}
