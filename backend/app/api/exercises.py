from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.serializers import exercise_list_items
from app.core.deps import DB, CurrentUser
from app.models.exercise import Attempt, Exercise, ExerciseNodeLink
from app.models.subject import Subject
from app.schemas.api import (
    AttemptCreate,
    AttemptOut,
    ExerciseFigureOut,
    ExerciseListItem,
    ExerciseOut,
    ExercisePartOut,
)

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
    return ExerciseOut(
        **item.model_dump(),
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
