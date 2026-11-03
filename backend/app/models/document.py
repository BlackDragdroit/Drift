from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.base import TimestampMixin, utcnow

if TYPE_CHECKING:
    from app.models.subject import Subject

JOB_STATUSES = ("pending", "running", "review", "done", "failed", "cancelled")


class Document(TimestampMixin, Base):
    """An uploaded PDF (exercise sheet, problem collection, exam)."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(String(300), nullable=False)  # relative to uploads dir
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False)
    has_text_layer: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    subject: Mapped["Subject"] = relationship()
    jobs: Mapped[list["ExtractionJob"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="ExtractionJob.id.desc()"
    )


class ExtractionJob(Base):
    """One run of the PDF -> exercises pipeline over a page range of a document."""

    __tablename__ = "extraction_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    page_from: Mapped[int] = mapped_column(Integer, nullable=False)
    page_to: Mapped[int] = mapped_column(Integer, nullable=False)
    chunks_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    chunks_done: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_pages: Mapped[str | None] = mapped_column(String(32))
    used_images: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    # Extracted drafts (review state); edited in the review screen until committed.
    draft: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    notes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_exercise_ids: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)

    document: Mapped[Document] = relationship(back_populates="jobs")
