from __future__ import annotations

import os
class Settings:
    @property
    def database_url(self) -> str:
        return os.getenv("DATABASE_URL", "sqlite:///./grouptrack.db")

    @property
    def session_signing_key(self) -> str:
        return os.getenv("SESSION_SIGNING_KEY", "dev-signing-key")

    @property
    def completion_threshold_n(self) -> int:
        return int(os.getenv("COMPLETION_THRESHOLD_N", "1"))

    @property
    def seed_demo(self) -> bool:
        return os.getenv("SEED_DEMO", "true").lower() == "true"

    @property
    def nudges_automation_enabled(self) -> bool:
        return os.getenv("NUDGE_AUTOMATION_ENABLED", "false").lower() == "true"

    @property
    def app_env(self) -> str:
        return os.getenv("APP_ENV", "dev")

    @property
    def public_base_url(self) -> str:
        return os.getenv("PUBLIC_BASE_URL", "http://localhost:8080")


settings = Settings()
