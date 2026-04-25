from __future__ import annotations

import os

from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite:///./test-e2e.db"
os.environ["SESSION_SIGNING_KEY"] = "test-key"
os.environ["SEED_DEMO"] = "true"

from app.main import app  # noqa: E402


def test_first_time_flow_under_one_minute() -> None:
    with TestClient(app) as client:
        join = client.post("/api/invites/DEMO2026/join", json={"displayName": "Lin"})
        group_id = join.json()["group"]["id"]
        token = join.json()["sessionToken"]
        habit_id = client.get(f"/api/groups/{group_id}").json()["habits"][0]["id"]
        result = client.post("/api/checkins", headers={"Authorization": f"Bearer {token}"}, json={"groupId": group_id, "habitId": habit_id, "day": "2026-04-25", "idempotencyKey": "33333333-3333-3333-3333-333333333333"})
        assert result.status_code == 201
