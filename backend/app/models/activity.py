from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.base import utcnow

ACTIVITY_KINDS = ("status", "attempt", "note", "session", "import", "exercises")


class ActivityEvent(Base):
    """One learning action; the dashboard derives streaks and daily totals from it."""

    __tablename__ = "activity_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    subject_id: Mapped[int | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), index=True
    )
    node_id: Mapped[int | None] = mapped_column(ForeignKey("plan_nodes.id", ondelete="SET NULL"))
    exercise_id: Mapped[int | None] = mapped_column(ForeignKey("exercises.id", ondelete="SET NULL"))
    minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    detail: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, nullable=False, index=True
    )


class StudySession(Base):
    """A timed study block, optionally bound to a topic node."""

    __tablename__ = "study_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int | None] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), index=True
    )
    node_id: Mapped[int | None] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="SET NULL"), index=True
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, nullable=False, index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
