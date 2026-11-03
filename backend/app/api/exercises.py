from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.serializers import exercise_list_items
from app.api.subjects import get_subject_or_404
from app.core.deps import DB, CurrentUser
from app.models.document import Document
from app.models.exercise import Attempt, Exercise, ExerciseNodeLink, ExercisePart
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import (
    AttemptCreate,
    AttemptOut,
    ExerciseCreate,
    ExerciseFigureOut,
    ExerciseListItem,
    ExerciseOut,
    ExercisePartOut,
    ExerciseUpdate,
)
from app.services import activity
from app.services import search as searchsvc

router = APIRouter(prefix="/exercises", tags=["exercises"])


def _get_exercise(db: DB, exercise_id: int, user_id: int) -> Exercise:
    ex = db.scalar(
        select(Exercise)
        .join(Subject)
        .options(
            selectinload(Exercise.parts),
            selectinload(Exercise.figures),
            selectinload(Exercise.attempts),
            selectinload(Exercise.node_links),
        )
        .where(Exercise.id == exercise_id, Subject.user_id == user_id)
    )
    if ex is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")
    return ex


def _exercise_out(db: DB, ex: Exercise) -> ExerciseOut:
    item = exercise_list_items(db, [ex])[0]
    doc_title = (
        db.scalar(select(Document.title).where(Document.id == ex.document_id))
        if ex.document_id
        else None
    )
    return ExerciseOut(
        **item.model_dump(),
        document_id=ex.document_id,
        document_title=doc_title,
        statement=ex.statement,
        hints=ex.hints,
        solution=ex.solution,
        tags=ex.tags,
        page_from=ex.page_from,
        page_to=ex.page_to,
        parts=[ExercisePartOut.model_validate(p) for p in ex.parts],
        figures=[
            ExerciseFigureOut(
                id=f.id,
                part_id=f.part_id,
                url=f"/api/files/{f.path}",
                caption=f.caption,
                page=f.page,
            )
            for f in ex.figures
        ],
        attempts=[AttemptOut.model_validate(a) for a in ex.attempts],
        node_ids=[link.node_id for link in ex.node_links],
    )


@router.get("", response_model=list[ExerciseListItem])
def list_exercises(
    db: DB, user: CurrentUser, subject_id: int | None = None, node_id: int | None = None
) -> list[ExerciseListItem]:
    stmt = (
        select(Exercise)
        .join(Subject)
        .where(Subject.user_id == user.id)
        .order_by(Exercise.subject_id, Exercise.number, Exercise.id)
    )
    if subject_id is not None:
        stmt = stmt.where(Exercise.subject_id == subject_id)
    if node_id is not None:
        stmt = stmt.join(ExerciseNodeLink).where(ExerciseNodeLink.node_id == node_id)
    return exercise_list_items(db, list(db.scalars(stmt)))


@router.get("/{exercise_id}", response_model=ExerciseOut)
def get(exercise_id: int, db: DB, user: CurrentUser) -> ExerciseOut:
    return _exercise_out(db, _get_exercise(db, exercise_id, user.id))


def _subject_node_ids(db: DB, subject_id: int) -> set[int]:
    return set(db.scalars(select(PlanNode.id).join(Plan).where(Plan.subject_id == subject_id)))


@router.post("", response_model=ExerciseOut, status_code=201)
def create(body: ExerciseCreate, db: DB, user: CurrentUser) -> ExerciseOut:
    subject = get_subject_or_404(db, body.subject_id, user.id)
    ex = Exercise(
        subject_id=subject.id,
        number=body.number,
        title=body.title.strip(),
        statement=body.statement,
        hints=body.hints,
        solution=body.solution,
        difficulty=body.difficulty,
        tags=body.tags,
        source_label="Manual",
    )
    ex.parts = [
        ExercisePart(
            label=p.label, statement=p.statement, hints=p.hints, solution=p.solution, sort_order=i
        )
        for i, p in enumerate(body.parts)
    ]
    allowed = _subject_node_ids(db, subject.id)
    ex.node_links = [
        ExerciseNodeLink(node_id=n) for n in dict.fromkeys(body.node_ids) if n in allowed
    ]
    db.add(ex)
    db.flush()
    searchsvc.index_exercise(db, ex)
    db.commit()
    return _exercise_out(db, _get_exercise(db, ex.id, user.id))


@router.patch("/{exercise_id}", response_model=ExerciseOut)
def update(exercise_id: int, body: ExerciseUpdate, db: DB, user: CurrentUser) -> ExerciseOut:
    ex = _get_exercise(db, exercise_id, user.id)
    data = body.model_dump(exclude_unset=True)
    parts = data.pop("parts", None)
    node_ids = data.pop("node_ids", None)
    if data.pop("clear_solution", False):
        ex.solution = None
        data.pop("solution", None)
    if data.pop("clear_difficulty", False):
        ex.difficulty = None
        data.pop("difficulty", None)
    for field, value in data.items():
        setattr(
            ex,
            field,
            value.strip() if isinstance(value, str) and field in ("title", "number") else value,
        )
    if parts is not None:
        ex.parts = [
            ExercisePart(
                label=p.label,
                statement=p.statement,
                hints=p.hints,
                solution=p.solution,
                sort_order=i,
            )
            for i, p in enumerate(body.parts or [])
        ]
    if node_ids is not None:
        allowed = _subject_node_ids(db, ex.subject_id)
        ex.node_links = [
            ExerciseNodeLink(node_id=n) for n in dict.fromkeys(node_ids) if n in allowed
        ]
    db.flush()
    searchsvc.index_exercise(db, ex)
    db.commit()
    return _exercise_out(db, _get_exercise(db, exercise_id, user.id))


@router.delete("/{exercise_id}", status_code=204)
def delete(exercise_id: int, db: DB, user: CurrentUser) -> None:
    ex = _get_exercise(db, exercise_id, user.id)
    searchsvc.remove(db, "exercise", ex.id)
    db.delete(ex)
    db.commit()


@router.post("/{exercise_id}/attempts", response_model=ExerciseOut, status_code=201)
def add_attempt(exercise_id: int, body: AttemptCreate, db: DB, user: CurrentUser) -> ExerciseOut:
    ex = _get_exercise(db, exercise_id, user.id)
    db.add(
        Attempt(
            exercise_id=ex.id,
            result=body.result,
            notes=body.notes,
            duration_seconds=body.duration_seconds,
        )
    )
    activity.log(
        db,
        "attempt",
        subject_id=ex.subject_id,
        exercise_id=ex.id,
        minutes=(body.duration_seconds or 0) // 60,
        detail=body.result,
    )
    db.commit()
    return _exercise_out(db, _get_exercise(db, exercise_id, user.id))


@router.delete("/{exercise_id}/attempts/{attempt_id}", status_code=204)
def delete_attempt(exercise_id: int, attempt_id: int, db: DB, user: CurrentUser) -> None:
    ex = _get_exercise(db, exercise_id, user.id)
    attempt = next((a for a in ex.attempts if a.id == attempt_id), None)
    if attempt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found")
    db.delete(attempt)
    db.commit()
