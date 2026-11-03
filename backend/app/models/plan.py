from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin, utcnow

STATUSES = ("not_started", "in_progress", "understood", "mastered")
DONE_STATUSES = ("understood", "mastered")
PREREQ_KINDS = ("required", "recommended")


class Plan(TimestampMixin, Base):
    __tablename__ = "plans"
    __table_args__ = (UniqueConstraint("subject_id", "key", name="uq_plan_subject_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    language: Mapped[str | None] = mapped_column(String(8))
    exam_date: Mapped[date | None] = mapped_column(Date)
    exam_name: Mapped[str | None] = mapped_column(String(120))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    resources: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    daily_capacity_minutes: Mapped[int] = mapped_column(Integer, default=120, nullable=False)
    last_imported_at: Mapped[datetime | None] = mapped_column(DateTime)

    subject: Mapped["Subject"] = relationship(back_populates="plans")  # noqa: F821
    nodes: Mapped[list["PlanNode"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="PlanNode.sort_order"
    )


class PlanNode(TimestampMixin, Base):
    __tablename__ = "plan_nodes"
    __table_args__ = (UniqueConstraint("plan_id", "key", name="uq_node_plan_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    objectives: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    difficulty: Mapped[int | None] = mapped_column(Integer)
    resources: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    keywords: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    plan: Mapped[Plan] = relationship(back_populates="nodes")
    parent: Mapped["PlanNode | None"] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list["PlanNode"]] = relationship(
        back_populates="parent", order_by="PlanNode.sort_order"
    )
    prerequisites: Mapped[list["NodePrerequisite"]] = relationship(
        back_populates="node",
        cascade="all, delete-orphan",
        foreign_keys="NodePrerequisite.node_id",
    )
    progress: Mapped["NodeProgress | None"] = relationship(
        back_populates="node", cascade="all, delete-orphan", uselist=False
    )
    note: Mapped["Note | None"] = relationship(
        back_populates="node", cascade="all, delete-orphan", uselist=False
    )
    flashcards: Mapped[list["Flashcard"]] = relationship(
        back_populates="node", cascade="all, delete-orphan"
    )


class NodePrerequisite(Base):
    __tablename__ = "node_prerequisites"

    node_id: Mapped[int] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="CASCADE"), primary_key=True
    )
    prerequisite_id: Mapped[int] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(16), default="required", nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    node: Mapped[PlanNode] = relationship(back_populates="prerequisites", foreign_keys=[node_id])
    prerequisite: Mapped[PlanNode] = relationship(foreign_keys=[prerequisite_id])


class NodeProgress(Base):
    __tablename__ = "node_progress"

    node_id: Mapped[int] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(16), default="not_started", nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    understood_at: Mapped[datetime | None] = mapped_column(DateTime)
    mastered_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    node: Mapped[PlanNode] = relationship(back_populates="progress")


class Note(TimestampMixin, Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    node_id: Mapped[int] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)

    node: Mapped[PlanNode] = relationship(back_populates="note")


class Flashcard(TimestampMixin, Base):
    __tablename__ = "flashcards"
    __table_args__ = (UniqueConstraint("node_id", "key", name="uq_flashcard_node_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    node_id: Mapped[int] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str | None] = mapped_column(String(120))
    front: Mapped[str] = mapped_column(Text, nullable=False)
    back: Mapped[str] = mapped_column(Text, nullable=False)
    # FSRS scheduling state (None until the first review); `due` is indexed for the review queue.
    fsrs: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    due: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    reps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    lapses: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_review: Mapped[datetime | None] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(
        String(16), default="plan", nullable=False
    )  # plan | manual | generated

    node: Mapped[PlanNode] = relationship(back_populates="flashcards")
