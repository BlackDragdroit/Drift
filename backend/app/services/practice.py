"""Practice queue builder: picks exercises by filters, in sequential / random / exam-mix order."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.exercise import Attempt, Exercise, ExerciseNodeLink
from app.models.plan import PlanNode

Mode = Literal["sequential", "random", "exam"]


@dataclass
class PracticeFilters:
    subject_id: int | None = None
    node_ids: list[int] | None = None
    plan_id: int | None = None
    difficulty_min: int | None = None
    difficulty_max: int | None = None
    unsolved_only: bool = False
    limit: int = 10
    mode: Mode = "random"
    seed: int | None = None


def build_queue(db: Session, f: PracticeFilters) -> list[int]:
    stmt = select(Exercise.id, Exercise.difficulty, Exercise.subject_id).distinct()
    if f.node_ids or f.plan_id:
        stmt = stmt.join(ExerciseNodeLink, ExerciseNodeLink.exercise_id == Exercise.id)
        if f.node_ids:
            stmt = stmt.where(ExerciseNodeLink.node_id.in_(f.node_ids))
        if f.plan_id:
            stmt = stmt.join(PlanNode, PlanNode.id == ExerciseNodeLink.node_id).where(
                PlanNode.plan_id == f.plan_id
            )
    if f.subject_id is not None:
        stmt = stmt.where(Exercise.subject_id == f.subject_id)
    if f.difficulty_min is not None:
        stmt = stmt.where((Exercise.difficulty >= f.difficulty_min) | Exercise.difficulty.is_(None))
    if f.difficulty_max is not None:
        stmt = stmt.where((Exercise.difficulty <= f.difficulty_max) | Exercise.difficulty.is_(None))
    rows = db.execute(stmt.order_by(Exercise.number, Exercise.id)).all()
    if not rows:
        return []

    ids = [r[0] for r in rows]
    last_result: dict[int, str] = {}
    if ids:
        # latest attempt per exercise
        sub = (
            select(Attempt.exercise_id, func.max(Attempt.created_at).label("latest"))
            .where(Attempt.exercise_id.in_(ids))
            .group_by(Attempt.exercise_id)
            .subquery()
        )
        for ex_id, result in db.execute(
            select(Attempt.exercise_id, Attempt.result).join(
                sub,
                (sub.c.exercise_id == Attempt.exercise_id) & (sub.c.latest == Attempt.created_at),
            )
        ):
            last_result[ex_id] = result
    if f.unsolved_only:
        rows = [r for r in rows if last_result.get(r[0]) != "solved"]

    rng = random.Random(f.seed)
    if f.mode == "sequential":
        ordered = [r[0] for r in rows]
    elif f.mode == "random":
        ordered = [r[0] for r in rows]
        rng.shuffle(ordered)
    else:  # exam mix: prefer not-yet-solved and failed ones, spread difficulties easy -> hard

        def weight(r: tuple[int, int | None, int]) -> float:
            last = last_result.get(r[0])
            return {"failed": 3.0, "partial": 2.0, None: 1.5, "solved": 0.6}.get(last, 1.0)

        pool = list(rows)
        picked: list[tuple[int, int | None, int]] = []
        while pool and len(picked) < f.limit:
            weights = [weight(r) for r in pool]
            choice = rng.choices(range(len(pool)), weights=weights, k=1)[0]
            picked.append(pool.pop(choice))
        picked.sort(key=lambda r: r[1] or 3)
        ordered = [r[0] for r in picked]
    return ordered[: f.limit]
