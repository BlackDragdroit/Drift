"""Model -> API schema conversion with computed graph state."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.document import ExtractionJob
from app.models.exercise import Attempt, Exercise, ExerciseNodeLink
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import (
    DocumentOut,
    ExerciseDraft,
    ExerciseListItem,
    JobDetailOut,
    JobOut,
    NodeOut,
    NodeProgressOut,
    PlanDetailOut,
    PlanSummaryOut,
    PrerequisiteOut,
    ProgressSummary,
    SubjectOut,
)
from app.services.extraction import estimate_cost_usd
from app.services.graph import NodeState, compute_progress, compute_states


def plan_summary(plan: Plan) -> PlanSummaryOut:
    progress = ProgressSummary(**compute_progress(plan.nodes).as_dict())
    return PlanSummaryOut(
        id=plan.id,
        subject_id=plan.subject_id,
        key=plan.key,
        title=plan.title,
        description=plan.description,
        language=plan.language,
        exam_date=plan.exam_date,
        exam_name=plan.exam_name,
        tags=plan.tags,
        daily_capacity_minutes=plan.daily_capacity_minutes,
        updated_at=plan.updated_at,
        last_imported_at=plan.last_imported_at,
        progress=progress,
    )


def subject_out(db: Session, subject: Subject) -> SubjectOut:
    plans = sorted(subject.plans, key=lambda p: p.updated_at, reverse=True)
    summaries = [plan_summary(p) for p in plans]
    total = ProgressSummary(
        nodes_total=sum(s.progress.nodes_total for s in summaries),
        nodes_done=sum(s.progress.nodes_done for s in summaries),
        nodes_in_progress=sum(s.progress.nodes_in_progress for s in summaries),
        minutes_total=sum(s.progress.minutes_total for s in summaries),
        minutes_done=sum(s.progress.minutes_done for s in summaries),
        ready_count=sum(s.progress.ready_count for s in summaries),
        percent=0.0,
    )
    if total.minutes_total:
        total.percent = round(100 * total.minutes_done / total.minutes_total, 1)
    elif total.nodes_total:
        total.percent = round(100 * total.nodes_done / total.nodes_total, 1)
    exercise_count = (
        db.scalar(select(func.count(Exercise.id)).where(Exercise.subject_id == subject.id)) or 0
    )
    return SubjectOut(
        id=subject.id,
        name=subject.name,
        slug=subject.slug,
        color=subject.color,
        icon=subject.icon,
        description=subject.description,
        sort_order=subject.sort_order,
        archived=subject.archived,
        created_at=subject.created_at,
        plans=summaries,
        progress=total if summaries else None,
        exercise_count=exercise_count,
    )


def node_out(
    node: PlanNode, state: NodeState, key_of: dict[int, str], exercise_counts: dict[int, int]
) -> NodeOut:
    p = node.progress
    return NodeOut(
        id=node.id,
        key=node.key,
        parent_id=node.parent_id if node.parent_id in key_of else None,
        title=node.title,
        description=node.description,
        objectives=node.objectives,
        estimated_minutes=node.estimated_minutes,
        difficulty=node.difficulty,
        resources=node.resources,
        keywords=node.keywords,
        sort_order=node.sort_order,
        prerequisites=[
            PrerequisiteOut(
                node_id=pr.prerequisite_id,
                key=key_of[pr.prerequisite_id],
                kind=pr.kind,
                note=pr.note,
            )
            for pr in node.prerequisites
            if pr.prerequisite_id in key_of
        ],
        progress=NodeProgressOut(
            status=p.status if p else "not_started",
            started_at=p.started_at if p else None,
            understood_at=p.understood_at if p else None,
            mastered_at=p.mastered_at if p else None,
            updated_at=p.updated_at if p else None,
        ),
        ready=state.ready,
        blocked_by=state.blocked_by,
        descendants_total=state.descendants_total,
        descendants_done=state.descendants_done,
        has_note=bool(node.note and node.note.content.strip()),
        flashcard_count=len(node.flashcards),
        exercise_count=exercise_counts.get(node.id, 0),
    )


def exercise_counts_for(db: Session, node_ids: list[int]) -> dict[int, int]:
    if not node_ids:
        return {}
    rows = db.execute(
        select(ExerciseNodeLink.node_id, func.count(ExerciseNodeLink.exercise_id))
        .where(ExerciseNodeLink.node_id.in_(node_ids))
        .group_by(ExerciseNodeLink.node_id)
    ).all()
    return {node_id: count for node_id, count in rows}


def plan_detail(db: Session, plan: Plan) -> PlanDetailOut:
    active = [n for n in plan.nodes if not n.archived]
    states = compute_states(active)
    key_of = {n.id: n.key for n in active}
    counts = exercise_counts_for(db, [n.id for n in active])
    summary = plan_summary(plan)
    return PlanDetailOut(
        **summary.model_dump(),
        resources=plan.resources,
        meta=plan.meta,
        schema_version=plan.schema_version,
        created_at=plan.created_at,
        subject_name=plan.subject.name,
        subject_color=plan.subject.color,
        nodes=[
            node_out(n, states[n.id], key_of, counts)
            for n in sorted(active, key=lambda n: n.sort_order)
        ],
    )


def exercise_list_items(db: Session, exercises: list[Exercise]) -> list[ExerciseListItem]:
    if not exercises:
        return []
    ids = [e.id for e in exercises]
    link_rows = db.execute(
        select(ExerciseNodeLink.exercise_id, PlanNode.key)
        .join(PlanNode, PlanNode.id == ExerciseNodeLink.node_id)
        .where(ExerciseNodeLink.exercise_id.in_(ids))
    ).all()
    keys: dict[int, list[str]] = {}
    for ex_id, key in link_rows:
        keys.setdefault(ex_id, []).append(key)
    attempt_rows = db.execute(
        select(Attempt.exercise_id, Attempt.result, Attempt.created_at)
        .where(Attempt.exercise_id.in_(ids))
        .order_by(Attempt.created_at.desc())
    ).all()
    last: dict[int, str] = {}
    count: dict[int, int] = {}
    for ex_id, result, _ in attempt_rows:
        last.setdefault(ex_id, result)
        count[ex_id] = count.get(ex_id, 0) + 1
    return [
        ExerciseListItem(
            id=e.id,
            subject_id=e.subject_id,
            number=e.number,
            title=e.title,
            difficulty=e.difficulty,
            source_label=e.source_label,
            node_keys=keys.get(e.id, []),
            last_result=last.get(e.id),
            attempt_count=count.get(e.id, 0),
        )
        for e in exercises
    ]


def job_out(job: ExtractionJob) -> JobOut:
    return JobOut(
        id=job.id,
        document_id=job.document_id,
        plan_id=job.plan_id,
        status=job.status,
        model=job.model,
        page_from=job.page_from,
        page_to=job.page_to,
        chunks_total=job.chunks_total,
        chunks_done=job.chunks_done,
        current_pages=job.current_pages,
        used_images=job.used_images,
        error=job.error,
        notes=job.notes or [],
        input_tokens=job.input_tokens,
        output_tokens=job.output_tokens,
        estimated_cost_usd=estimate_cost_usd(job.model, job.input_tokens, job.output_tokens),
        created_exercise_ids=job.created_exercise_ids or [],
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def job_detail_out(job: ExtractionJob, document: DocumentOut) -> JobDetailOut:
    drafts = None
    if job.draft is not None:
        drafts = []
        for d in job.draft:
            figures = [{**f, "url": f"/api/files/{f['path']}"} for f in d.get("figures", [])]
            drafts.append(ExerciseDraft.model_validate({**d, "figures": figures}))
    return JobDetailOut(**job_out(job).model_dump(), draft=drafts, document=document)


def load_subject(db: Session, subject_id: int, user_id: int) -> Subject | None:
    return db.scalar(
        select(Subject)
        .options(
            selectinload(Subject.plans)
            .selectinload(Plan.nodes)
            .selectinload(PlanNode.prerequisites),
            selectinload(Subject.plans).selectinload(Plan.nodes).selectinload(PlanNode.progress),
        )
        .where(Subject.id == subject_id, Subject.user_id == user_id)
    )
