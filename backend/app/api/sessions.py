from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import DB, CurrentUser
from app.models.activity import StudySession
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import SessionOut, SessionStart, SessionStop
from app.services import activity

router = APIRouter(prefix="/sessions", tags=["sessions"])


def session_out(db: Session, s: StudySession) -> SessionOut:
    title = db.scalar(select(PlanNode.title).where(PlanNode.id == s.node_id)) if s.node_id else None
    return SessionOut(
        id=s.id,
        subject_id=s.subject_id,
        node_id=s.node_id,
        node_title=title,
        started_at=s.started_at,
        ended_at=s.ended_at,
        duration_seconds=s.duration_seconds,
        note=s.note,
    )


@router.get("/active", response_model=SessionOut | None)
def active(db: DB, _: CurrentUser) -> SessionOut | None:
    s = activity.active_session(db)
    return session_out(db, s) if s else None


@router.post("/start", response_model=SessionOut, status_code=201)
def start(body: SessionStart, db: DB, user: CurrentUser) -> SessionOut:
    subject_id = body.subject_id
    if body.node_id is not None:
        row = db.execute(
            select(PlanNode.id, Plan.subject_id)
            .join(Plan, Plan.id == PlanNode.plan_id)
            .join(Subject)
            .where(PlanNode.id == body.node_id, Subject.user_id == user.id)
        ).first()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Node not found")
        subject_id = row[1]
    elif (
        subject_id is not None
        and db.scalar(
            select(Subject.id).where(Subject.id == subject_id, Subject.user_id == user.id)
        )
        is None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Subject not found")
    s = activity.start_session(db, subject_id, body.node_id)
    db.commit()
    return session_out(db, s)


@router.post("/{session_id}/stop", response_model=SessionOut)
def stop(session_id: int, body: SessionStop, db: DB, _: CurrentUser) -> SessionOut:
    s = db.get(StudySession, session_id)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    activity.stop_session(db, s, body.note)
    db.commit()
    return session_out(db, s)


@router.get("", response_model=list[SessionOut])
def list_sessions(
    db: DB,
    _: CurrentUser,
    node_id: int | None = None,
    subject_id: int | None = None,
    limit: int = 50,
) -> list[SessionOut]:
    stmt = (
        select(StudySession)
        .where(StudySession.ended_at.is_not(None))
        .order_by(StudySession.started_at.desc())
        .limit(min(limit, 200))
    )
    if node_id is not None:
        stmt = stmt.where(StudySession.node_id == node_id)
    if subject_id is not None:
        stmt = stmt.where(StudySession.subject_id == subject_id)
    return [session_out(db, s) for s in db.scalars(stmt)]


@router.delete("/{session_id}", status_code=204)
def delete(session_id: int, db: DB, _: CurrentUser) -> None:
    s = db.get(StudySession, session_id)
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    db.delete(s)
    db.commit()
