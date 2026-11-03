from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin, utcnow

ATTEMPT_RESULTS = ("solved", "partial", "failed")


class Exercise(TimestampMixin, Base):
    __tablename__ = "exercises"
    __table_args__ = (UniqueConstraint("plan_id", "key", name="uq_exercise_plan_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Set when the exercise was embedded in an imported plan (used as merge key on re-import).
    plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("plans.id", ondelete="SET NULL"), index=True
    )
    key: Mapped[str | None] = mapped_column(String(200))
    number: Mapped[str | None] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    statement: Mapped[str] = mapped_column(Text, default="", nullable=False)
    hints: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    solution: Mapped[str | None] = mapped_column(Text)
    difficulty: Mapped[int | None] = mapped_column(Integer)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    source_label: Mapped[str | None] = mapped_column(String(200))
    # Phase 2: link to the uploaded PDF and page range.
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), index=True
    )
    page_from: Mapped[int | None] = mapped_column(Integer)
    page_to: Mapped[int | None] = mapped_column(Integer)

    subject: Mapped["Subject"] = relationship(back_populates="exercises")  # noqa: F821
    parts: Mapped[list["ExercisePart"]] = relationship(
        back_populates="exercise", cascade="all, delete-orphan", order_by="ExercisePart.sort_order"
    )
    figures: Mapped[list["ExerciseFigure"]] = relationship(
        back_populates="exercise",
        cascade="all, delete-orphan",
        order_by="ExerciseFigure.sort_order",
    )
    node_links: Mapped[list["ExerciseNodeLink"]] = relationship(
        back_populates="exercise", cascade="all, delete-orphan"
    )
    attempts: Mapped[list["Attempt"]] = relationship(
        back_populates="exercise",
        cascade="all, delete-orphan",
        order_by="Attempt.created_at.desc()",
    )


class ExercisePart(Base):
    __tablename__ = "exercise_parts"

    id: Mapped[int] = mapped_column(primary_key=True)
    exercise_id: Mapped[int] = mapped_column(
        ForeignKey("exercises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(16), nullable=False)
    statement: Mapped[str] = mapped_column(Text, default="", nullable=False)
    hints: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    solution: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    exercise: Mapped[Exercise] = relationship(back_populates="parts")


class ExerciseFigure(Base):
    __tablename__ = "exercise_figures"

    id: Mapped[int] = mapped_column(primary_key=True)
    exercise_id: Mapped[int] = mapped_column(
        ForeignKey("exercises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    part_id: Mapped[int | None] = mapped_column(
        ForeignKey("exercise_parts.id", ondelete="SET NULL")
    )
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    page: Mapped[int | None] = mapped_column(Integer)
    bbox: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    caption: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    exercise: Mapped[Exercise] = relationship(back_populates="figures")


class ExerciseNodeLink(Base):
    __tablename__ = "exercise_node_links"

    exercise_id: Mapped[int] = mapped_column(
        ForeignKey("exercises.id", ondelete="CASCADE"), primary_key=True
    )
    node_id: Mapped[int] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="CASCADE"), primary_key=True
    )

    exercise: Mapped[Exercise] = relationship(back_populates="node_links")
    node: Mapped["PlanNode"] = relationship()  # noqa: F821


class Attempt(Base):
    __tablename__ = "attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    exercise_id: Mapped[int] = mapped_column(
        ForeignKey("exercises.id", ondelete="CASCADE"), nullable=False, index=True
    )
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, nullable=False, index=True
    )

    exercise: Mapped[Exercise] = relationship(back_populates="attempts")
