from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db() -> None:
    os.environ["DATABASE_URL"] = "sqlite:///./test-api.db"
    os.environ["SESSION_SIGNING_KEY"] = "test-key"
    os.environ["SEED_DEMO"] = "true"
    db = Path("test-api.db")
    if db.exists():
        db.unlink()


def test_join_checkin_and_heatmap() -> None:
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        join = client.post("/api/invites/DEMO2026/join", json={"displayName": "Grace"})
        assert join.status_code == 201
        payload = join.json()
        group_id = payload["group"]["id"]
        token = payload["sessionToken"]
        habits = client.get(f"/api/groups/{group_id}", headers={"X-Session-Token": token}).json()["habits"]
        habit_id = habits[0]["id"]
        checkin = client.post("/api/checkins", headers={"X-Session-Token": token}, json={"groupId": group_id, "habitId": habit_id, "day": "2026-04-25", "idempotencyKey": "22222222-2222-2222-2222-222222222222"})
        assert checkin.status_code == 201
        replay = client.post("/api/checkins", headers={"X-Session-Token": token}, json={"groupId": group_id, "habitId": habit_id, "day": "2026-04-25", "idempotencyKey": "22222222-2222-2222-2222-222222222222"})
        assert replay.status_code == 200
        assert replay.json()["idempotent"] is True
        heatmap = client.get(f"/api/groups/{group_id}/heatmap", params={"scope": "group", "habitId": habit_id})
        assert heatmap.status_code == 200
        assert heatmap.json()["version"] >= 1
