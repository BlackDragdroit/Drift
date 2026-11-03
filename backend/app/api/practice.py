from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.deps import DB, CurrentUser
from app.models.exercise import Exercise
from app.models.subject import Subject
from app.schemas.api import PracticeQueueOut, PracticeRequest
from app.services.practice import PracticeFilters, build_queue

router = APIRouter(prefix="/practice", tags=["practice"])


@router.post("/queue", response_model=PracticeQueueOut)
def queue(body: PracticeRequest, db: DB, user: CurrentUser) -> PracticeQueueOut:
    # Scope to the user's subjects: when no subject is given, take all of them.
    subject_ids = set(db.scalars(select(Subject.id).where(Subject.user_id == user.id)))
    if body.subject_id is not None and body.subject_id not in subject_ids:
        return PracticeQueueOut(exercise_ids=[], total_available=0)
    filters = PracticeFilters(
        subject_id=body.subject_id,
        node_ids=body.node_ids,
        plan_id=body.plan_id,
        difficulty_min=body.difficulty_min,
        difficulty_max=body.difficulty_max,
        unsolved_only=body.unsolved_only,
        limit=body.limit,
        mode=body.mode,
        seed=body.seed,
    )
    ids = build_queue(db, filters)
    if body.subject_id is None:
        allowed = (
            set(
                db.scalars(
                    select(Exercise.id).where(
                        Exercise.subject_id.in_(subject_ids), Exercise.id.in_(ids)
                    )
                )
            )
            if ids
            else set()
        )
        ids = [i for i in ids if i in allowed]
    total_filters = PracticeFilters(**{**filters.__dict__, "limit": 10_000, "mode": "sequential"})
    total = len(build_queue(db, total_filters))
    return PracticeQueueOut(exercise_ids=ids, total_available=total)


@router.get("/stats")
def stats(db: DB, user: CurrentUser, subject_id: int | None = None) -> dict[str, int]:
    stmt = select(func.count(Exercise.id)).join(Subject).where(Subject.user_id == user.id)
    if subject_id is not None:
        stmt = stmt.where(Exercise.subject_id == subject_id)
    return {"exercises": db.scalar(stmt) or 0}
