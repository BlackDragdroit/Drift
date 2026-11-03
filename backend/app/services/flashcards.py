"""Spaced repetition with FSRS (py-fsrs): due queue, reviews, state persistence."""

from __future__ import annotations

from datetime import UTC, datetime

from fsrs import Card, Rating, Scheduler, State
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity import ActivityEvent
from app.models.base import utcnow
from app.models.plan import Flashcard, Plan, PlanNode
from app.models.review import FlashcardReview

_scheduler = Scheduler(desired_retention=0.9, enable_fuzzing=True)
RATINGS = {1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy}


def _card_for(fc: Flashcard) -> Card:
    if fc.fsrs:
        return Card.from_dict(fc.fsrs)
    return Card(card_id=fc.id, due=datetime.now(UTC))


def _naive(dt: datetime) -> datetime:
    return dt.astimezone(UTC).replace(tzinfo=None) if dt.tzinfo else dt


def review(db: Session, fc: Flashcard, rating: int, duration_ms: int | None = None) -> Flashcard:
    card = _card_for(fc)
    before_state = card.state
    card, _log = _scheduler.review_card(
        card, RATINGS[rating], review_datetime=datetime.now(UTC), review_duration=duration_ms
    )
    fc.fsrs = card.to_dict()
    fc.due = _naive(card.due)
    fc.last_review = utcnow()
    fc.reps += 1
    if rating == 1 and before_state == State.Review:
        fc.lapses += 1
    db.add(FlashcardReview(flashcard_id=fc.id, rating=rating, duration_ms=duration_ms))
    node = db.get(PlanNode, fc.node_id)
    plan = db.get(Plan, node.plan_id) if node else None
    db.add(
        ActivityEvent(
            kind="review",
            subject_id=plan.subject_id if plan else None,
            node_id=fc.node_id,
            detail=str(rating),
        )
    )
    return fc


def preview_intervals(fc: Flashcard) -> dict[str, str]:
    """Human-readable next interval per rating, for the review buttons."""
    card = _card_for(fc)
    now = datetime.now(UTC)
    out: dict[str, str] = {}
    for r, rating in RATINGS.items():
        nxt, _ = Scheduler(desired_retention=0.9, enable_fuzzing=False).review_card(
            card, rating, review_datetime=now
        )
        delta = nxt.due - now
        minutes = int(delta.total_seconds() // 60)
        key = str(r)
        if minutes < 60:
            out[key] = f"{max(minutes, 1)}m"
        elif minutes < 24 * 60:
            out[key] = f"{minutes // 60}h"
        elif delta.days < 30:
            out[key] = f"{delta.days}d"
        else:
            out[key] = f"{round(delta.days / 30.4, 1):g}mo"
    return out


def retrievability(fc: Flashcard) -> float | None:
    if not fc.fsrs:
        return None
    return round(float(_scheduler.get_card_retrievability(_card_for(fc))), 3)


def due_query(
    subject_id: int | None = None,
    plan_id: int | None = None,
    node_id: int | None = None,
    include_new: bool = True,
):
    now = utcnow()
    stmt = (
        select(Flashcard)
        .join(PlanNode, PlanNode.id == Flashcard.node_id)
        .join(Plan, Plan.id == PlanNode.plan_id)
        .where(PlanNode.archived.is_(False))
    )
    cond = Flashcard.due <= now
    if include_new:
        cond = cond | Flashcard.due.is_(None)
    stmt = stmt.where(cond)
    if node_id is not None:
        stmt = stmt.where(Flashcard.node_id == node_id)
    if plan_id is not None:
        stmt = stmt.where(Plan.id == plan_id)
    if subject_id is not None:
        stmt = stmt.where(Plan.subject_id == subject_id)
    # overdue first, then new cards, within that oldest first
    return stmt.order_by(Flashcard.due.is_(None), Flashcard.due, Flashcard.id)


def due_counts(db: Session, user_id: int) -> dict[str, int]:
    from app.models.subject import Subject

    now = utcnow()
    base = (
        select(func.count(Flashcard.id))
        .join(PlanNode, PlanNode.id == Flashcard.node_id)
        .join(Plan, Plan.id == PlanNode.plan_id)
        .join(Subject, Subject.id == Plan.subject_id)
        .where(Subject.user_id == user_id, PlanNode.archived.is_(False))
    )
    due = db.scalar(base.where(Flashcard.due <= now)) or 0
    new = db.scalar(base.where(Flashcard.due.is_(None))) or 0
    total = db.scalar(base) or 0
    return {"due": due, "new": new, "total": total}
