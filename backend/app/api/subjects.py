from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.serializers import load_subject, subject_out
from app.core.deps import DB, CurrentUser
from app.core.text import slugify, unique_slug
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import SubjectCreate, SubjectOut, SubjectUpdate

router = APIRouter(prefix="/subjects", tags=["subjects"])


def get_subject_or_404(db: DB, subject_id: int, user_id: int) -> Subject:
    subject = load_subject(db, subject_id, user_id)
    if subject is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subject not found")
    return subject


def create_subject(
    db: DB,
    user_id: int,
    name: str,
    color: str = "#6366f1",
    icon: str = "book-open",
    description: str = "",
) -> Subject:
    taken = set(db.scalars(select(Subject.slug).where(Subject.user_id == user_id)))
    max_order = max(
        (s for s in db.scalars(select(Subject.sort_order).where(Subject.user_id == user_id))),
        default=-1,
    )
    subject = Subject(
        user_id=user_id,
        name=name.strip(),
        slug=unique_slug(slugify(name), taken),
        color=color,
        icon=icon,
        description=description,
        sort_order=max_order + 1,
    )
    db.add(subject)
    db.commit()
    return subject


@router.get("", response_model=list[SubjectOut])
def list_subjects(db: DB, user: CurrentUser, include_archived: bool = False) -> list[SubjectOut]:
    stmt = (
        select(Subject)
        .options(
            selectinload(Subject.plans)
            .selectinload(Plan.nodes)
            .selectinload(PlanNode.prerequisites),
            selectinload(Subject.plans).selectinload(Plan.nodes).selectinload(PlanNode.progress),
        )
        .where(Subject.user_id == user.id)
        .order_by(Subject.sort_order, Subject.name)
    )
    if not include_archived:
        stmt = stmt.where(Subject.archived.is_(False))
    return [subject_out(db, s) for s in db.scalars(stmt)]


@router.post("", response_model=SubjectOut, status_code=201)
def create(body: SubjectCreate, db: DB, user: CurrentUser) -> SubjectOut:
    subject = create_subject(db, user.id, body.name, body.color, body.icon, body.description)
    return subject_out(db, get_subject_or_404(db, subject.id, user.id))


@router.get("/{subject_id}", response_model=SubjectOut)
def get(subject_id: int, db: DB, user: CurrentUser) -> SubjectOut:
    return subject_out(db, get_subject_or_404(db, subject_id, user.id))


@router.patch("/{subject_id}", response_model=SubjectOut)
def update(subject_id: int, body: SubjectUpdate, db: DB, user: CurrentUser) -> SubjectOut:
    subject = get_subject_or_404(db, subject_id, user.id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(
            subject, field, value.strip() if isinstance(value, str) and field == "name" else value
        )
    db.commit()
    return subject_out(db, get_subject_or_404(db, subject.id, user.id))


@router.delete("/{subject_id}", status_code=204)
def delete(subject_id: int, db: DB, user: CurrentUser) -> None:
    subject = get_subject_or_404(db, subject_id, user.id)
    db.delete(subject)
    db.commit()
