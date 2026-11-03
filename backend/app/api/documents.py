import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.serializers import job_out
from app.api.subjects import get_subject_or_404
from app.core.config import get_settings
from app.core.deps import DB, CurrentUser, SettingsDep
from app.models.document import Document, ExtractionJob
from app.models.exercise import Exercise
from app.models.plan import Plan
from app.models.subject import Subject
from app.schemas.api import DocumentOut, JobOut, StartExtractionRequest
from app.services import pdf as pdfsvc
from app.services.jobs import runner

log = logging.getLogger("app.documents")
router = APIRouter(prefix="/documents", tags=["documents"])


def get_document_or_404(db: DB, document_id: int, user_id: int) -> Document:
    doc = db.scalar(
        select(Document)
        .join(Subject)
        .options(selectinload(Document.jobs))
        .where(Document.id == document_id, Subject.user_id == user_id)
    )
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


def document_out(db: DB, doc: Document) -> DocumentOut:
    count = db.scalar(select(func.count(Exercise.id)).where(Exercise.document_id == doc.id)) or 0
    latest = doc.jobs[0] if doc.jobs else None
    return DocumentOut(
        id=doc.id,
        subject_id=doc.subject_id,
        filename=doc.filename,
        title=doc.title,
        page_count=doc.page_count,
        size_bytes=doc.size_bytes,
        has_text_layer=doc.has_text_layer,
        created_at=doc.created_at,
        exercise_count=count,
        latest_job=job_out(latest) if latest else None,
    )


@router.get("", response_model=list[DocumentOut])
def list_documents(db: DB, user: CurrentUser, subject_id: int | None = None) -> list[DocumentOut]:
    stmt = (
        select(Document)
        .join(Subject)
        .options(selectinload(Document.jobs))
        .where(Subject.user_id == user.id)
        .order_by(Document.created_at.desc())
    )
    if subject_id is not None:
        stmt = stmt.where(Document.subject_id == subject_id)
    return [document_out(db, d) for d in db.scalars(stmt)]


@router.post("", response_model=DocumentOut, status_code=201)
async def upload(
    db: DB,
    user: CurrentUser,
    settings: SettingsDep,
    file: Annotated[UploadFile, File()],
    subject_id: Annotated[int, Form()],
    title: Annotated[str | None, Form()] = None,
) -> DocumentOut:
    subject = get_subject_or_404(db, subject_id, user.id)
    if not (file.filename or "").lower().endswith(".pdf") and file.content_type not in (
        "application/pdf",
        "application/x-pdf",
    ):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only PDF files are supported.")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB."
        )
    if not data.startswith(b"%PDF"):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "This does not look like a PDF."
        )
    abs_path, rel_path = pdfsvc.store_upload(subject.id, file.filename or "document.pdf", data)
    try:
        info = pdfsvc.inspect_pdf(abs_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Could not read PDF: {exc}"
        ) from exc
    existing = db.scalar(
        select(Document).where(Document.subject_id == subject.id, Document.sha256 == info.sha256)
    )
    if existing:
        return document_out(db, get_document_or_404(db, existing.id, user.id))
    doc = Document(
        subject_id=subject.id,
        filename=file.filename or "document.pdf",
        title=(title or Path(file.filename or "Document").stem).strip()[:255],
        path=rel_path,
        sha256=info.sha256,
        size_bytes=info.size_bytes,
        page_count=info.page_count,
        has_text_layer=info.has_text_layer,
    )
    db.add(doc)
    db.commit()
    return document_out(db, get_document_or_404(db, doc.id, user.id))


@router.get("/{document_id}", response_model=DocumentOut)
def get(document_id: int, db: DB, user: CurrentUser) -> DocumentOut:
    return document_out(db, get_document_or_404(db, document_id, user.id))


@router.delete("/{document_id}", status_code=204)
def delete(document_id: int, db: DB, user: CurrentUser) -> None:
    doc = get_document_or_404(db, document_id, user.id)
    for job in doc.jobs:
        runner.cancel(job.id)
    path = get_settings().uploads_dir / doc.path
    db.delete(doc)
    db.commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        log.warning("Could not delete %s", path)


@router.get("/{document_id}/file")
def file(document_id: int, db: DB, user: CurrentUser) -> FileResponse:
    doc = get_document_or_404(db, document_id, user.id)
    return FileResponse(
        get_settings().uploads_dir / doc.path,
        media_type="application/pdf",
        filename=doc.filename,
        content_disposition_type="inline",
    )


@router.get("/{document_id}/pages/{page}")
def page_image(
    document_id: int, page: int, db: DB, user: CurrentUser, zoom: float = pdfsvc.PAGE_ZOOM
) -> FileResponse:
    doc = get_document_or_404(db, document_id, user.id)
    if not 1 <= page <= doc.page_count:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Page out of range")
    zoom = min(max(zoom, 0.5), 3.0)
    img = pdfsvc.cached_page_image(doc.id, get_settings().uploads_dir / doc.path, page, zoom)
    return FileResponse(
        img, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"}
    )


@router.post("/{document_id}/extract", response_model=JobOut, status_code=201)
def start_extraction(
    document_id: int, body: StartExtractionRequest, db: DB, user: CurrentUser, settings: SettingsDep
) -> JobOut:
    doc = get_document_or_404(db, document_id, user.id)
    if not settings.anthropic_api_key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "ANTHROPIC_API_KEY is not configured on the server."
        )
    if any(j.status in ("pending", "running") for j in doc.jobs):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "An extraction is already running for this document."
        )
    page_from = body.page_from or 1
    page_to = body.page_to or doc.page_count
    if page_from > page_to or page_to > doc.page_count:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Page range must be within 1-{doc.page_count}."
        )
    if body.plan_id is not None:
        plan = db.get(Plan, body.plan_id)
        if plan is None or plan.subject_id != doc.subject_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Plan does not belong to this subject."
            )
    job = ExtractionJob(
        document_id=doc.id,
        plan_id=body.plan_id,
        model=settings.anthropic_model,
        page_from=page_from,
        page_to=page_to,
    )
    db.add(job)
    db.commit()
    runner.start(job.id)
    return job_out(job)
