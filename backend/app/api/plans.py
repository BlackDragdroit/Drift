import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.serializers import plan_detail, plan_summary
from app.api.subjects import create_subject, get_subject_or_404
from app.core.deps import DB, CurrentUser
from app.models.exercise import Exercise
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import (
    GenerationPromptOut,
    ImportPreviewOut,
    ImportPreviewRequest,
    ImportRequest,
    ImportResultOut,
    IssueOut,
    PlanDetailOut,
    PlanSummaryOut,
    PlanUpdate,
    ScheduleOut,
)
from app.schemas.plan_format import plan_json_schema
from app.services import activity
from app.services import search as searchsvc
from app.services.plan_export import export_plan
from app.services.plan_import import (
    ImportError_,
    ImportOptions,
    apply_import,
    load_plan,
    preview_import,
    validate_text,
)
from app.services.plan_prompt import build_generation_prompt
from app.services.schedule import build_schedule

router = APIRouter(prefix="/plans", tags=["plans"])


def get_plan_or_404(db: DB, plan_id: int, user_id: int) -> Plan:
    plan = load_plan(db, plan_id)
    if plan is None or plan.subject.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")
    return plan


@router.get("/schema.json")
def schema() -> dict[str, Any]:
    return plan_json_schema()


@router.get("/generation-prompt", response_model=GenerationPromptOut)
def generation_prompt(
    _: CurrentUser,
    topic: str = Query("<TOPIC>", max_length=300),
    context: str = Query("", max_length=2000),
    language: str = Query("en", max_length=16),
    exam_date: str | None = Query(None, max_length=10),
    node_count: str = Query("15-30", max_length=16),
) -> GenerationPromptOut:
    return GenerationPromptOut(
        prompt=build_generation_prompt(topic, context, language, exam_date, node_count)
    )


@router.get("", response_model=list[PlanSummaryOut])
def list_plans(db: DB, user: CurrentUser, subject_id: int | None = None) -> list[PlanSummaryOut]:
    stmt = (
        select(Plan)
        .join(Subject)
        .options(
            selectinload(Plan.nodes).selectinload(PlanNode.prerequisites),
            selectinload(Plan.nodes).selectinload(PlanNode.progress),
        )
        .where(Subject.user_id == user.id)
        .order_by(Plan.updated_at.desc())
    )
    if subject_id is not None:
        stmt = stmt.where(Plan.subject_id == subject_id)
    return [plan_summary(p) for p in db.scalars(stmt)]


@router.get("/{plan_id}", response_model=PlanDetailOut)
def get(plan_id: int, db: DB, user: CurrentUser) -> PlanDetailOut:
    return plan_detail(db, get_plan_or_404(db, plan_id, user.id))


@router.patch("/{plan_id}", response_model=PlanDetailOut)
def update(plan_id: int, body: PlanUpdate, db: DB, user: CurrentUser) -> PlanDetailOut:
    plan = get_plan_or_404(db, plan_id, user.id)
    data = body.model_dump(exclude_unset=True)
    clear_exam = data.pop("clear_exam", False)
    for field, value in data.items():
        setattr(plan, field, value)
    if clear_exam:
        plan.exam_date = None
        plan.exam_name = None
    db.commit()
    return plan_detail(db, get_plan_or_404(db, plan_id, user.id))


@router.delete("/{plan_id}", status_code=204)
def delete(plan_id: int, db: DB, user: CurrentUser) -> None:
    plan = get_plan_or_404(db, plan_id, user.id)
    for n in plan.nodes:
        searchsvc.remove(db, "node", n.id)
        searchsvc.remove(db, "note", n.id)
    searchsvc.remove(db, "plan", plan.id)
    db.delete(plan)
    db.commit()


@router.get("/{plan_id}/schedule", response_model=ScheduleOut)
def schedule(plan_id: int, db: DB, user: CurrentUser) -> ScheduleOut:
    plan = get_plan_or_404(db, plan_id, user.id)
    result = build_schedule(plan)
    return ScheduleOut(
        summary=result.summary.__dict__,
        days=[
            {"date": d.date, "minutes": d.minutes, "nodes": [n.__dict__ for n in d.nodes]}
            for d in result.days
        ],
    )


@router.get("/{plan_id}/export")
def export(
    plan_id: int,
    db: DB,
    user: CurrentUser,
    include_progress: bool = True,
    include_notes: bool = True,
    download: bool = True,
) -> Response:
    plan = get_plan_or_404(db, plan_id, user.id)
    doc = export_plan(db, plan, include_progress=include_progress, include_notes=include_notes)
    body = json.dumps(doc, indent=2, ensure_ascii=False)
    headers = {"Content-Disposition": f'attachment; filename="{plan.key}.json"'} if download else {}
    return Response(content=body, media_type="application/json", headers=headers)


def _issues_out(issues) -> list[IssueOut]:
    return [IssueOut(**i.as_dict()) for i in issues]


@router.post("/import/preview", response_model=ImportPreviewOut)
def import_preview(body: ImportPreviewRequest, db: DB, user: CurrentUser) -> ImportPreviewOut:
    try:
        result, detected = validate_text(body.content, body.format)
    except ImportError_ as exc:
        return ImportPreviewOut(ok=False, issues=_issues_out(exc.issues))
    if not result.ok or result.plan is None:
        return ImportPreviewOut(
            ok=False, detected_format=detected, issues=_issues_out(result.issues)
        )
    spec = result.plan
    subject_id = body.subject_id
    if body.plan_id is not None:
        subject_id = get_plan_or_404(db, body.plan_id, user.id).subject_id
    if subject_id is not None:
        get_subject_or_404(db, subject_id, user.id)
        preview = preview_import(db, spec, subject_id, body.plan_id)
        return ImportPreviewOut(
            ok=True,
            detected_format=detected,
            issues=_issues_out(result.issues),
            subject_name=spec.subject,
            **preview.as_dict(),
        )
    # No subject chosen yet: we can still say what would be created.
    return ImportPreviewOut(
        ok=True,
        detected_format=detected,
        issues=_issues_out(result.issues),
        mode="create",
        plan_key=spec.id,
        plan_title=spec.title,
        subject_name=spec.subject,
        counts={"added": len(spec.nodes), "changed": 0, "unchanged": 0, "removed": 0},
        nodes=[
            {
                "key": n.id,
                "title": n.title,
                "change": "added",
                "fields": [],
                "has_progress": False,
                "has_note": False,
            }
            for n in spec.nodes
        ],
        exercises=sum(len(n.exercises) for n in spec.nodes),
        flashcards=sum(len(n.flashcards) for n in spec.nodes),
        has_progress_block=bool(spec.progress),
        has_notes_block=bool(spec.notes),
    )


@router.post("/import", response_model=ImportResultOut)
def import_plan(body: ImportRequest, db: DB, user: CurrentUser) -> ImportResultOut:
    try:
        result, _ = validate_text(body.content, body.format)
    except ImportError_ as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, [i.as_dict() for i in exc.issues]
        ) from exc
    if not result.ok or result.plan is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, [i.as_dict() for i in result.issues]
        )
    spec = result.plan

    if body.plan_id is not None:
        subject = get_subject_or_404(
            db, get_plan_or_404(db, body.plan_id, user.id).subject_id, user.id
        )
    elif body.subject_id is not None:
        subject = get_subject_or_404(db, body.subject_id, user.id)
    else:
        name = (body.new_subject_name or spec.subject or "").strip()
        if not name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Choose a subject or provide a name for a new one.",
            )
        existing = db.scalar(
            select(Subject).where(Subject.user_id == user.id, Subject.name == name)
        )
        subject = existing or create_subject(db, user.id, name)
        subject = get_subject_or_404(db, subject.id, user.id)

    options = ImportOptions(
        removed_nodes=body.removed_nodes,
        import_progress=body.import_progress,
        import_notes=body.import_notes,
        overwrite_existing_progress=body.overwrite_existing_progress,
    )
    try:
        plan = apply_import(db, spec, subject, body.plan_id, options)
    except ImportError_ as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, [i.as_dict() for i in exc.issues]
        ) from exc
    searchsvc.index_plan_tree(db, plan)
    for ex in db.scalars(select(Exercise).where(Exercise.plan_id == plan.id)):
        searchsvc.index_exercise(db, ex)
    activity.log(db, "import", subject_id=subject.id, detail=plan.key[:64])
    db.commit()
    return ImportResultOut(
        plan_id=plan.id, subject_id=subject.id, issues=_issues_out(result.issues)
    )
