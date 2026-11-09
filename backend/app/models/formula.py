from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin

FORMULA_SOURCES = ("manual", "exercise", "generated")


class FormulaEntry(TimestampMixin, Base):
    """One line of a plan's formula sheet: a formula (Markdown + LaTeX) with a short title and
    an optional "when it applies" note. Grouped by topic for display; survives the topic."""

    __tablename__ = "formula_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(
        ForeignKey("plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    node_id: Mapped[int | None] = mapped_column(
        ForeignKey("plan_nodes.id", ondelete="SET NULL"), index=True
    )
    exercise_id: Mapped[int | None] = mapped_column(ForeignKey("exercises.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    plan: Mapped["Plan"] = relationship()  # noqa: F821
    node: Mapped["PlanNode | None"] = relationship()  # noqa: F821
