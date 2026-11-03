from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser
from app.models.plan import Flashcard, Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import (
    DueQueueOut,
    FlashcardCreate,
    FlashcardDetailOut,
    FlashcardReviewIn,
    FlashcardUpdate,
    GenerateCardsRequest,
    GeneratedOut,
)
from app.services import flashcards as fsvc
from app.services import generation

router = APIRouter(prefix="/flashcards", tags=["flashcards"])


def _node_for_user(db: Session, node_id: int, user_id: int) -> tuple[PlanNode, Plan, Subject]:
    row = db.execute(
        select(PlanNode, Plan, Subject)
        .join(Plan, Plan.id == PlanNode.plan_id)
        .join(Subject, Subject.id == Plan.subject_id)
        .where(PlanNode.id == node_id, Subject.user_id == user_id)
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Node not found")
    return row[0], row[1], row[2]


def _card_for_user(db: Session, card_id: int, user_id: int) -> Flashcard:
    fc = db.scalar(
        select(Flashcard)
        .join(PlanNode, PlanNode.id == Flashcard.node_id)
        .join(Plan, Plan.id == PlanNode.plan_id)
        .join(Subject, Subject.id == Plan.subject_id)
        .where(Flashcard.id == card_id, Subject.user_id == user_id)
    )
    if fc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Flashcard not found")
    return fc


def card_out(db: Session, fc: Flashcard, with_intervals: bool = False) -> FlashcardDetailOut:
    row = db.execute(
        select(PlanNode.title, Plan.id, Subject.id, Subject.color)
        .join(Plan, Plan.id == PlanNode.plan_id)
        .join(Subject, Subject.id == Plan.subject_id)
        .where(PlanNode.id == fc.node_id)
    ).first()
    return FlashcardDetailOut(
        id=fc.id,
        node_id=fc.node_id,
        front=fc.front,
        back=fc.back,
        due=fc.due,
        reps=fc.reps,
        lapses=fc.lapses,
        last_review=fc.last_review,
        source=fc.source,
        retrievability=fsvc.retrievability(fc),
        node_title=row[0] if row else None,
        plan_id=row[1] if row else None,
        subject_id=row[2] if row else None,
        subject_color=row[3] if row else None,
        intervals=fsvc.preview_intervals(fc) if with_intervals else None,
    )


@router.get("/due", response_model=DueQueueOut)
def due(
    db: DB,
    user: CurrentUser,
    subject_id: int | None = None,
    plan_id: int | None = None,
    node_id: int | None = None,
    limit: int = 30,
) -> DueQueueOut:
    stmt = (
        fsvc.due_query(subject_id, plan_id, node_id)
        .join(Subject, Subject.id == Plan.subject_id)
        .where(Subject.user_id == user.id)
        .limit(min(limit, 200))
    )
    cards = [card_out(db, fc, with_intervals=True) for fc in db.scalars(stmt)]
    counts = fsvc.due_counts(db, user.id)
    return DueQueueOut(cards=cards, **counts)


@router.get("", response_model=list[FlashcardDetailOut])
def list_cards(db: DB, user: CurrentUser, node_id: int) -> list[FlashcardDetailOut]:
    _node_for_user(db, node_id, user.id)
    return [
        card_out(db, fc)
        for fc in db.scalars(
            select(Flashcard).where(Flashcard.node_id == node_id).order_by(Flashcard.id)
        )
    ]


@router.post("", response_model=FlashcardDetailOut, status_code=201)
def create(body: FlashcardCreate, db: DB, user: CurrentUser) -> FlashcardDetailOut:
    _node_for_user(db, body.node_id, user.id)
    fc = Flashcard(node_id=body.node_id, front=body.front, back=body.back, source="manual")
    db.add(fc)
    db.commit()
    return card_out(db, fc)


@router.patch("/{card_id}", response_model=FlashcardDetailOut)
def update(card_id: int, body: FlashcardUpdate, db: DB, user: CurrentUser) -> FlashcardDetailOut:
    fc = _card_for_user(db, card_id, user.id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(fc, k, v)
    db.commit()
    return card_out(db, fc)


@router.delete("/{card_id}", status_code=204)
def delete(card_id: int, db: DB, user: CurrentUser) -> None:
    fc = _card_for_user(db, card_id, user.id)
    db.delete(fc)
    db.commit()


@router.post("/{card_id}/review", response_model=FlashcardDetailOut)
def review(card_id: int, body: FlashcardReviewIn, db: DB, user: CurrentUser) -> FlashcardDetailOut:
    fc = _card_for_user(db, card_id, user.id)
    fsvc.review(db, fc, body.rating, body.duration_ms)
    db.commit()
    return card_out(db, fc)


@router.post("/generate/{node_id}", response_model=GeneratedOut)
async def generate(
    node_id: int, body: GenerateCardsRequest, db: DB, user: CurrentUser
) -> GeneratedOut:
    node, _plan, _subject = _node_for_user(db, node_id, user.id)
    existing = [
        fc.front for fc in db.scalars(select(Flashcard).where(Flashcard.node_id == node.id))
    ]
    try:
        cards, usage = await generation.generate_cards(
            node, body.count, existing, node.note.content if node.note else None
        )
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    for c in cards:
        db.add(Flashcard(node_id=node.id, front=c.front, back=c.back, source="generated"))
    db.commit()
    return GeneratedOut(
        created=len(cards), input_tokens=usage.input_tokens, output_tokens=usage.output_tokens
    )
