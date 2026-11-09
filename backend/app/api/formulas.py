from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.plans import get_plan_or_404
from app.core.deps import DB, CurrentUser
from app.models.base import utcnow
from app.models.exercise import Exercise
from app.models.formula import FormulaEntry
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import (
    FormulaCandidateOut,
    FormulaCreate,
    FormulaHarvestOut,
    FormulaHarvestRequest,
    FormulaOut,
    FormulaReorder,
    FormulaUpdate,
)
from app.services import formulas as fsvc

router = APIRouter(prefix="/formulas", tags=["formulas"])


def _node_for_user(db: Session, node_id: int, user_id: int) -> PlanNode:
    node = db.scalar(
        select(PlanNode)
        .join(Plan, Plan.id == PlanNode.plan_id)
        .join(Subject, Subject.id == Plan.subject_id)
        .where(PlanNode.id == node_id, Subject.user_id == user_id)
    )
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Node not found")
    return node


def _entry_for_user(db: Session, entry_id: int, user_id: int) -> FormulaEntry:
    entry = db.scalar(
        select(FormulaEntry)
        .join(Plan, Plan.id == FormulaEntry.plan_id)
        .join(Subject, Subject.id == Plan.subject_id)
        .where(FormulaEntry.id == entry_id, Subject.user_id == user_id)
    )
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Formula not found")
    return entry


def _out(db: Session, e: FormulaEntry) -> FormulaOut:
    title = db.scalar(select(PlanNode.title).where(PlanNode.id == e.node_id)) if e.node_id else None
    return FormulaOut.model_validate(e, from_attributes=True).model_copy(
        update={"node_title": title}
    )


@router.get("", response_model=list[FormulaOut])
def list_entries(db: DB, user: CurrentUser, plan_id: int) -> list[FormulaOut]:
    plan = get_plan_or_404(db, plan_id, user.id)
    titles = {n.id: n.title for n in plan.nodes}
    return [
        FormulaOut.model_validate(e, from_attributes=True).model_copy(
            update={"node_title": titles.get(e.node_id) if e.node_id else None}
        )
        for e in fsvc.ordered_entries(db, plan)
    ]


@router.get("/export.md")
def export_markdown(db: DB, user: CurrentUser, plan_id: int) -> Response:
    plan = get_plan_or_404(db, plan_id, user.id)
    text = fsvc.to_markdown(plan, fsvc.ordered_entries(db, plan), utcnow())
    return Response(
        text,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{plan.key}-formulas.md"'},
    )


@router.post("", response_model=FormulaOut, status_code=201)
def create(body: FormulaCreate, db: DB, user: CurrentUser) -> FormulaOut:
    node = _node_for_user(db, body.node_id, user.id) if body.node_id is not None else None
    plan_id = node.plan_id if node else body.plan_id
    if plan_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "plan_id or node_id is required")
    plan = get_plan_or_404(db, plan_id, user.id)
    exercise_id = body.exercise_id
    if exercise_id is not None:
        owned = db.scalar(
            select(Exercise.id)
            .join(Subject, Subject.id == Exercise.subject_id)
            .where(Exercise.id == exercise_id, Subject.user_id == user.id)
        )
        exercise_id = owned
    entry = FormulaEntry(
        plan_id=plan.id,
        node_id=node.id if node else None,
        exercise_id=exercise_id,
        title=body.title.strip(),
        content=body.content.strip(),
        note=body.note.strip(),
        source=body.source,
        sort_order=fsvc.next_sort_order(db, plan.id, node.id if node else None),
    )
    db.add(entry)
    db.commit()
    return _out(db, entry)


@router.patch("/{entry_id}", response_model=FormulaOut)
def update(entry_id: int, body: FormulaUpdate, db: DB, user: CurrentUser) -> FormulaOut:
    entry = _entry_for_user(db, entry_id, user.id)
    data = body.model_dump(exclude_unset=True)
    if "node_id" in data and data["node_id"] is not None:
        node = _node_for_user(db, data["node_id"], user.id)
        if node.plan_id != entry.plan_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Node belongs to another plan"
            )
    if "node_id" in data and data["node_id"] != entry.node_id:
        data["sort_order"] = fsvc.next_sort_order(db, entry.plan_id, data["node_id"])
    for k, v in data.items():
        setattr(entry, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return _out(db, entry)


@router.delete("/{entry_id}", status_code=204)
def delete(entry_id: int, db: DB, user: CurrentUser) -> None:
    entry = _entry_for_user(db, entry_id, user.id)
    db.delete(entry)
    db.commit()


@router.post("/reorder", response_model=list[FormulaOut])
def reorder(body: FormulaReorder, db: DB, user: CurrentUser, plan_id: int) -> list[FormulaOut]:
    plan = get_plan_or_404(db, plan_id, user.id)
    fsvc.reorder(db, plan, body.ids)
    db.commit()
    return list_entries(db, user, plan_id)


@router.post("/harvest", response_model=FormulaHarvestOut)
async def harvest(body: FormulaHarvestRequest, db: DB, user: CurrentUser) -> FormulaHarvestOut:
    if (body.exercise_id is None) == (body.node_id is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Give exactly one of exercise_id or node_id"
        )
    if body.node_id is not None:
        node = _node_for_user(db, body.node_id, user.id)
        plan = get_plan_or_404(db, node.plan_id, user.id)
        material, exercise_id = fsvc.node_material(db, node), None
    else:
        ex = db.scalar(
            select(Exercise)
            .join(Subject, Subject.id == Exercise.subject_id)
            .where(Exercise.id == body.exercise_id, Subject.user_id == user.id)
        )
        if ex is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")
        node = next(
            (
                link.node
                for link in ex.node_links
                if link.node is not None and not link.node.archived
            ),
            None,
        )
        if node is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Link the exercise to a topic first so the formulas have a plan to go to",
            )
        plan = get_plan_or_404(db, node.plan_id, user.id)
        material, exercise_id = fsvc.exercise_material(ex), ex.id
    existing = [
        e.title or e.content.splitlines()[0]
        for e in db.scalars(select(FormulaEntry).where(FormulaEntry.plan_id == plan.id))
    ]
    try:
        candidates, usage = await fsvc.harvest(material, existing)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return FormulaHarvestOut(
        plan_id=plan.id,
        node_id=node.id,
        exercise_id=exercise_id,
        candidates=[FormulaCandidateOut(**c.model_dump()) for c in candidates],
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )
