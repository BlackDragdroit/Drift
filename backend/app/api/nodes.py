from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.serializers import exercise_counts_for, exercise_list_items, node_out
from app.core.deps import DB, CurrentUser
from app.models.exercise import Exercise, ExerciseNodeLink
from app.models.plan import NodePrerequisite, Note, Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import (
    FlashcardOut,
    NodeDetailOut,
    NodeOut,
    NodeUpdate,
    NoteOut,
    NoteUpdate,
    PrerequisiteOut,
    ProgressUpdate,
)
from app.services import activity
from app.services import search as searchsvc
from app.services.activity import minutes_by_node
from app.services.graph import compute_states
from app.services.plan_import import load_plan, set_status

router = APIRouter(prefix="/nodes", tags=["nodes"])


def _get_node(db: DB, node_id: int, user_id: int) -> tuple[PlanNode, Plan]:
    node = db.scalar(
        select(PlanNode)
        .join(Plan)
        .join(Subject)
        .options(
            selectinload(PlanNode.note),
            selectinload(PlanNode.flashcards),
            selectinload(PlanNode.progress),
        )
        .where(PlanNode.id == node_id, Subject.user_id == user_id)
    )
    if node is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Node not found")
    plan = load_plan(db, node.plan_id)
    assert plan is not None
    return next(n for n in plan.nodes if n.id == node.id), plan


def _node_out(db: DB, node: PlanNode, plan: Plan) -> NodeOut:
    active = [n for n in plan.nodes if not n.archived]
    states = compute_states(active)
    key_of = {n.id: n.key for n in active}
    return node_out(node, states[node.id], key_of, exercise_counts_for(db, [node.id]))


@router.get("/{node_id}", response_model=NodeDetailOut)
def get(node_id: int, db: DB, user: CurrentUser) -> NodeDetailOut:
    node, plan = _get_node(db, node_id, user.id)
    base = _node_out(db, node, plan)
    exercises = list(
        db.scalars(
            select(Exercise)
            .join(ExerciseNodeLink)
            .where(ExerciseNodeLink.node_id == node.id)
            .order_by(Exercise.number, Exercise.id)
        )
    )
    key_of = {n.id: n.key for n in plan.nodes if not n.archived}
    dependents = db.execute(
        select(NodePrerequisite.node_id, NodePrerequisite.kind, NodePrerequisite.note).where(
            NodePrerequisite.prerequisite_id == node.id
        )
    ).all()
    return NodeDetailOut(
        **base.model_dump(),
        actual_minutes=minutes_by_node(db, [node.id]).get(node.id, 0),
        plan_id=plan.id,
        plan_title=plan.title,
        note=NoteOut(
            content=node.note.content if node.note else "",
            updated_at=node.note.updated_at if node.note else None,
        ),
        flashcards=[FlashcardOut.model_validate(c) for c in node.flashcards],
        exercises=exercise_list_items(db, exercises),
        dependents=[
            PrerequisiteOut(node_id=nid, key=key_of[nid], kind=kind, note=note)
            for nid, kind, note in dependents
            if nid in key_of
        ],
    )


@router.patch("/{node_id}", response_model=NodeOut)
def update(node_id: int, body: NodeUpdate, db: DB, user: CurrentUser) -> NodeOut:
    node, plan = _get_node(db, node_id, user.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(node, field, value)
    searchsvc.index_node(db, node, plan.subject_id)
    db.commit()
    node, plan = _get_node(db, node_id, user.id)
    return _node_out(db, node, plan)


@router.put("/{node_id}/progress", response_model=NodeOut)
def update_progress(node_id: int, body: ProgressUpdate, db: DB, user: CurrentUser) -> NodeOut:
    node, plan = _get_node(db, node_id, user.id)
    previous = node.progress.status if node.progress else "not_started"
    set_status(node, body.status)
    if body.status != previous:
        activity.log(db, "status", subject_id=plan.subject_id, node_id=node.id, detail=body.status)
    db.commit()
    node, plan = _get_node(db, node_id, user.id)
    return _node_out(db, node, plan)


@router.put("/{node_id}/note", response_model=NoteOut)
def update_note(node_id: int, body: NoteUpdate, db: DB, user: CurrentUser) -> NoteOut:
    node, plan = _get_node(db, node_id, user.id)
    if node.note is None:
        node.note = Note(content=body.content)
    else:
        node.note.content = body.content
    db.flush()
    searchsvc.index_note(db, node.note, node, plan.subject_id)
    activity.log(db, "note", subject_id=plan.subject_id, node_id=node.id)
    db.commit()
    db.refresh(node.note)
    return NoteOut(content=node.note.content, updated_at=node.note.updated_at)
