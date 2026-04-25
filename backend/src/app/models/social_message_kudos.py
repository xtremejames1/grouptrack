from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class SocialMessageKudos(Base):
    __tablename__ = "social_message_kudos"
    __table_args__ = (UniqueConstraint("social_message_id", "user_id", name="uq_social_message_kudos_message_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    social_message_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("social_messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False, index=True)
