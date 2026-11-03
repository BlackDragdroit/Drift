"""In-process runner for extraction jobs.

One job at a time (API usage stays predictable), progress persisted to SQLite after every chunk,
cancellation checked between chunks, and jobs interrupted by a restart are marked failed on startup.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.models.base import utcnow
from app.models.document import Document, ExtractionJob
from app.models.plan import Plan, PlanNode
from app.services import extraction
from app.services import pdf as pdfsvc

log = logging.getLogger("app.jobs")


def _db() -> Session:
    return get_sessionmaker()()


def _update(job_id: int, **values: Any) -> None:
    with _db() as db:
        db.execute(update(ExtractionJob).where(ExtractionJob.id == job_id).values(**values))
        db.commit()


def topics_for(db: Session, subject_id: int, plan_id: int | None) -> list[dict[str, Any]]:
    stmt = (
        select(PlanNode)
        .join(Plan)
        .where(Plan.subject_id == subject_id, PlanNode.archived.is_(False))
    )
    if plan_id is not None:
        stmt = stmt.where(Plan.id == plan_id)
    return [
        {"id": n.id, "title": n.title, "keywords": n.keywords or []}
        for n in db.scalars(stmt.order_by(Plan.id, PlanNode.sort_order))
    ]


async def run_extraction(
    job_id: int,
    caller: extraction.ModelCaller | None = None,
    is_cancelled: Callable[[], bool] = lambda: False,
) -> None:
    caller = caller or extraction.call_model  # resolved late so tests can monkeypatch it
    settings = get_settings()
    with _db() as db:
        job = db.get(ExtractionJob, job_id)
        if job is None:
            return
        doc = db.get(Document, job.document_id)
        assert doc is not None
        pdf_path = settings.uploads_dir / doc.path
        topics = topics_for(db, doc.subject_id, job.plan_id)
        allowed = {t["id"] for t in topics}
        filename, total_pages, use_images = (
            doc.title or doc.filename,
            doc.page_count,
            not doc.has_text_layer,
        )
        doc_id, page_from, page_to, model = doc.id, job.page_from, job.page_to, job.model

    chunks = extraction.plan_chunks(page_from, page_to, settings.extract_chunk_pages)
    _update(
        job_id,
        status="running",
        chunks_total=len(chunks),
        chunks_done=0,
        started_at=utcnow(),
        error=None,
        used_images=use_images,
    )

    results: list[extraction.ChunkOut] = []
    notes: list[str] = []
    try:
        for a, b in chunks:
            if is_cancelled():
                _update(job_id, status="cancelled", finished_at=utcnow(), current_pages=None)
                return
            _update(job_id, current_pages=f"{a}-{b}")
            content = await asyncio.to_thread(_build_content, pdf_path, a, b, use_images)
            content.append(
                {
                    "type": "text",
                    "text": extraction.build_user_prompt(
                        filename, total_pages, a, b, topics, use_images
                    ),
                }
            )
            chunk, usage = await extraction.extract_chunk(
                caller=caller,
                model=model,
                api_key=settings.anthropic_api_key,
                content=content,
                page_from=a,
                page_to=b,
                allowed_node_ids=allowed,
            )
            results.append(chunk)
            notes.extend(chunk.notes)
            with _db() as db:
                row = db.get(ExtractionJob, job_id)
                if row is None:
                    return
                row.chunks_done += 1
                row.input_tokens += usage.input_tokens
                row.output_tokens += usage.output_tokens
                row.notes = list(notes)
                db.commit()

        exercises = extraction.stitch(results)
        built = await asyncio.to_thread(extraction.build_drafts, exercises, doc_id, pdf_path)
        notes.extend(built.warnings)
        _update(
            job_id,
            status="review",
            draft=built.drafts,
            notes=notes,
            finished_at=utcnow(),
            current_pages=None,
        )
    except asyncio.CancelledError:
        _update(job_id, status="cancelled", finished_at=utcnow(), current_pages=None)
        raise
    except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
        log.exception("Extraction job %s failed", job_id)
        _update(
            job_id,
            status="failed",
            error=f"{type(exc).__name__}: {exc}"[:2000],
            finished_at=utcnow(),
            current_pages=None,
        )


def _build_content(pdf_path: Path, a: int, b: int, use_images: bool) -> list[dict[str, Any]]:
    if use_images:
        return [
            extraction.image_block(pdfsvc.render_page_jpeg(pdf_path, p)) for p in range(a, b + 1)
        ]
    return [extraction.document_block(pdfsvc.sub_pdf_bytes(pdf_path, a, b))]


class JobRunner:
    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task[None]] = {}
        self._cancelled: set[int] = set()
        self._sem: asyncio.Semaphore | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def attach(self, loop: asyncio.AbstractEventLoop) -> None:
        """Remember the application's event loop so sync request handlers can schedule jobs."""
        self._loop = loop
        self._sem = asyncio.Semaphore(1)

    def start(self, job_id: int, caller: extraction.ModelCaller | None = None) -> None:
        self._cancelled.discard(job_id)
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is not None and (self._loop is None or running is self._loop):
            self._spawn(job_id, caller)
        elif self._loop is not None:
            self._loop.call_soon_threadsafe(self._spawn, job_id, caller)
        else:
            raise RuntimeError("Job runner is not attached to an event loop.")

    def _spawn(self, job_id: int, caller: extraction.ModelCaller | None) -> None:
        self._sem = self._sem or asyncio.Semaphore(1)
        self._tasks[job_id] = asyncio.create_task(self._guarded(job_id, caller))

    async def _guarded(self, job_id: int, caller: extraction.ModelCaller | None) -> None:
        assert self._sem is not None
        async with self._sem:
            if job_id in self._cancelled:
                _update(job_id, status="cancelled", finished_at=utcnow())
                return
            try:
                await run_extraction(
                    job_id, caller=caller, is_cancelled=lambda: job_id in self._cancelled
                )
            finally:
                self._tasks.pop(job_id, None)
                self._cancelled.discard(job_id)

    def cancel(self, job_id: int) -> None:
        self._cancelled.add(job_id)
        with _db() as db:
            job = db.get(ExtractionJob, job_id)
            if job and job.status == "pending":
                job.status = "cancelled"
                job.finished_at = utcnow()
                db.commit()

    def is_active(self, job_id: int) -> bool:
        return job_id in self._tasks

    async def shutdown(self) -> None:
        for task in list(self._tasks.values()):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)


runner = JobRunner()


def recover_stale_jobs(db: Session) -> int:
    """Called on startup: jobs that were running when the process died cannot resume."""
    res = db.execute(
        update(ExtractionJob)
        .where(ExtractionJob.status.in_(("pending", "running")))
        .values(
            status="failed",
            error="Interrupted by a server restart. Start the extraction again.",
            finished_at=utcnow(),
            current_pages=None,
        )
    )
    db.commit()
    return res.rowcount or 0
