from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.documents import document_out
from app.api.serializers import job_detail_out, job_out
from app.core.config import get_settings
from app.core.deps import DB, CurrentUser
from app.models.base import utcnow
from app.models.document import Document, ExtractionJob
from app.models.exercise import Exercise, ExerciseFigure, ExerciseNodeLink, ExercisePart
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import (
    CommitOut,
    CommitRequest,
    CropRequest,
    DraftUpdate,
    FigureDraft,
    JobDetailOut,
    JobOut,
)
from app.services import pdf as pdfsvc
from app.services.extraction import _new_id
from app.services.jobs import runner

router = APIRouter(prefix="/jobs", tags=["jobs"])


def get_job_or_404(db: DB, job_id: int, user_id: int) -> ExtractionJob:
    job = db.scalar(
        select(ExtractionJob)
        .join(Document)
        .join(Subject)
        .options(selectinload(ExtractionJob.document).selectinload(Document.jobs))
        .where(ExtractionJob.id == job_id, Subject.user_id == user_id)
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


def _detail(db: DB, job: ExtractionJob) -> JobDetailOut:
    return job_detail_out(job, document_out(db, job.document))


@router.get("", response_model=list[JobOut])
def list_jobs(
    db: DB, user: CurrentUser, document_id: int | None = None, subject_id: int | None = None
) -> list[JobOut]:
    stmt = (
        select(ExtractionJob)
        .join(Document)
        .join(Subject)
        .where(Subject.user_id == user.id)
        .order_by(ExtractionJob.id.desc())
    )
    if document_id is not None:
        stmt = stmt.where(ExtractionJob.document_id == document_id)
    if subject_id is not None:
        stmt = stmt.where(Document.subject_id == subject_id)
    return [job_out(j) for j in db.scalars(stmt.limit(100))]


@router.get("/{job_id}", response_model=JobDetailOut)
def get(job_id: int, db: DB, user: CurrentUser) -> JobDetailOut:
    return _detail(db, get_job_or_404(db, job_id, user.id))


@router.post("/{job_id}/cancel", response_model=JobOut)
def cancel(job_id: int, db: DB, user: CurrentUser) -> JobOut:
    job = get_job_or_404(db, job_id, user.id)
    if job.status not in ("pending", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Job is not running.")
    runner.cancel(job.id)
    db.refresh(job)
    return job_out(job)


@router.delete("/{job_id}", status_code=204)
def delete(job_id: int, db: DB, user: CurrentUser) -> None:
    job = get_job_or_404(db, job_id, user.id)
    if job.status in ("pending", "running"):
        runner.cancel(job.id)
    db.delete(job)
    db.commit()


@router.put("/{job_id}/draft", response_model=JobDetailOut)
def save_draft(job_id: int, body: DraftUpdate, db: DB, user: CurrentUser) -> JobDetailOut:
    job = get_job_or_404(db, job_id, user.id)
    if job.status != "review":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Drafts can only be edited while the job is in review."
        )
    job.draft = [e.model_dump(exclude={"figures": {"__all__": {"url"}}}) for e in body.exercises]
    db.commit()
    return _detail(db, job)


@router.post("/{job_id}/figures", response_model=FigureDraft)
def crop(job_id: int, body: CropRequest, db: DB, user: CurrentUser) -> FigureDraft:
    job = get_job_or_404(db, job_id, user.id)
    doc = job.document
    if not 1 <= body.page <= doc.page_count:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Page out of range")
    try:
        rel, bbox = pdfsvc.crop_figure(
            doc.id, get_settings().uploads_dir / doc.path, body.page, body.bbox
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return FigureDraft(
        id=_new_id(),
        page=body.page,
        bbox=list(bbox),
        caption=body.caption,
        path=rel,
        url=f"/api/files/{rel}",
    )


@router.post("/{job_id}/commit", response_model=CommitOut)
def commit(job_id: int, body: CommitRequest, db: DB, user: CurrentUser) -> CommitOut:
    job = get_job_or_404(db, job_id, user.id)
    if job.status != "review":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only jobs in review can be committed.")
    doc = job.document
    subject_nodes = set(
        db.scalars(select(PlanNode.id).join(Plan).where(Plan.subject_id == doc.subject_id))
    )
    created: list[int] = []
    skipped = 0
    for d in body.exercises:
        if not d.statement.strip() and not any(p.statement.strip() for p in d.parts):
            skipped += 1
            continue
        pages = (
            f"p. {d.page_from}" if d.page_from == d.page_to else f"pp. {d.page_from}-{d.page_to}"
        )
        ex = Exercise(
            subject_id=doc.subject_id,
            document_id=doc.id,
            page_from=d.page_from,
            page_to=d.page_to,
            number=(d.number or None),
            title=(
                d.title.strip() or (f"Exercise {d.number}" if d.number else f"{doc.title} {pages}")
            )[:200],
            statement=d.statement,
            hints=d.hints,
            solution=d.solution,
            difficulty=d.difficulty,
            source_label=f"{doc.title} · {pages}",
        )
        ex.parts = [
            ExercisePart(
                label=p.label,
                statement=p.statement,
                hints=p.hints,
                solution=p.solution,
                sort_order=i,
            )
            for i, p in enumerate(d.parts)
        ]
        db.add(ex)
        db.flush()
        part_by_label = {p.label: p.id for p in ex.parts}
        ex.figures = [
            ExerciseFigure(
                path=f.path,
                page=f.page,
                bbox={"x0": f.bbox[0], "y0": f.bbox[1], "x1": f.bbox[2], "y1": f.bbox[3]},
                caption=f.caption,
                part_id=part_by_label.get(f.part_label or ""),
                sort_order=i,
            )
            for i, f in enumerate(d.figures)
        ]
        ex.node_links = [
            ExerciseNodeLink(node_id=nid)
            for nid in dict.fromkeys(d.node_ids)
            if nid in subject_nodes
        ]
        created.append(ex.id)
    job.status = "done"
    job.created_exercise_ids = created
    job.draft = None
    job.finished_at = utcnow()
    db.commit()
    return CommitOut(exercise_ids=created, skipped=skipped)
