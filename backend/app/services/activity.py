"""Activity log: streaks, daily study minutes and weak spots."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.activity import ActivityEvent, StudySession
from app.models.base import utcnow
from app.models.exercise import Attempt, Exercise, ExerciseNodeLink
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject

MAX_SESSION_SECONDS = 4 * 3600  # a forgotten timer is capped here


def log(
    db: Session,
    kind: str,
    *,
    subject_id: int | None = None,
    node_id: int | None = None,
    exercise_id: int | None = None,
    minutes: int = 0,
    detail: str | None = None,
) -> None:
    db.add(
        ActivityEvent(
            kind=kind,
            subject_id=subject_id,
            node_id=node_id,
            exercise_id=exercise_id,
            minutes=minutes,
            detail=detail,
        )
    )


def _local_day(ts: datetime, tz_offset_minutes: int) -> date:
    return (ts + timedelta(minutes=tz_offset_minutes)).date()


@dataclass
class StreakInfo:
    current: int
    longest: int
    active_today: bool
    minutes_today: int
    days: list[date]  # last 7 days with activity (for a mini calendar)


def streak(db: Session, tz_offset_minutes: int = 0, today: date | None = None) -> StreakInfo:
    now_local = utcnow() + timedelta(minutes=tz_offset_minutes)
    today = today or now_local.date()
    since = utcnow() - timedelta(days=400)
    rows = db.execute(
        select(ActivityEvent.created_at, ActivityEvent.minutes).where(
            ActivityEvent.created_at >= since
        )
    ).all()
    by_day: dict[date, int] = {}
    for ts, minutes in rows:
        d = _local_day(ts, tz_offset_minutes)
        by_day[d] = by_day.get(d, 0) + (minutes or 0)
    active = set(by_day)
    # current streak counts back from today, or from yesterday if today has nothing yet
    cur = 0
    start = today if today in active else today - timedelta(days=1)
    d = start
    while d in active:
        cur += 1
        d -= timedelta(days=1)
    longest = 0
    run = 0
    prev: date | None = None
    for d in sorted(active):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        longest = max(longest, run)
        prev = d
    last7 = [today - timedelta(days=i) for i in range(6, -1, -1)]
    return StreakInfo(
        current=cur,
        longest=longest,
        active_today=today in active,
        minutes_today=by_day.get(today, 0),
        days=[d for d in last7 if d in active],
    )


@dataclass
class WeakSpot:
    node_id: int
    key: str
    title: str
    plan_id: int
    plan_title: str
    subject_id: int
    subject_name: str
    subject_color: str
    attempts: int
    failed: int
    partial: int
    score: float


def weak_spots(db: Session, days: int = 45, limit: int = 8) -> list[WeakSpot]:
    since = utcnow() - timedelta(days=days)
    rows = db.execute(
        select(
            PlanNode.id,
            PlanNode.key,
            PlanNode.title,
            Plan.id,
            Plan.title,
            Subject.id,
            Subject.name,
            Subject.color,
            func.count(Attempt.id),
            func.sum(func.iif(Attempt.result == "failed", 1, 0)),
            func.sum(func.iif(Attempt.result == "partial", 1, 0)),
        )
        .select_from(Attempt)
        .join(Exercise, Exercise.id == Attempt.exercise_id)
        .join(ExerciseNodeLink, ExerciseNodeLink.exercise_id == Exercise.id)
        .join(PlanNode, PlanNode.id == ExerciseNodeLink.node_id)
        .join(Plan, Plan.id == PlanNode.plan_id)
        .join(Subject, Subject.id == Plan.subject_id)
        .where(Attempt.created_at >= since, PlanNode.archived.is_(False))
        .group_by(PlanNode.id)
    ).all()
    spots = []
    for nid, key, title, pid, ptitle, sid, sname, scolor, total, failed, partial in rows:
        failed, partial = int(failed or 0), int(partial or 0)
        score = (failed + 0.5 * partial) / max(total, 1)
        if failed + partial == 0:
            continue
        spots.append(
            WeakSpot(
                nid,
                key,
                title,
                pid,
                ptitle,
                sid,
                sname,
                scolor,
                int(total),
                failed,
                partial,
                round(score, 2),
            )
        )
    spots.sort(key=lambda w: (-w.score, -w.attempts))
    return spots[:limit]


def start_session(db: Session, subject_id: int | None, node_id: int | None) -> StudySession:
    # Only one running session at a time: stop any leftovers first.
    for s in db.scalars(select(StudySession).where(StudySession.ended_at.is_(None))):
        stop_session(db, s)
    session = StudySession(subject_id=subject_id, node_id=node_id)
    db.add(session)
    db.flush()
    return session


def stop_session(db: Session, session: StudySession, note: str = "") -> StudySession:
    if session.ended_at is None:
        now = utcnow()
        seconds = int((now - session.started_at).total_seconds())
        session.duration_seconds = max(0, min(seconds, MAX_SESSION_SECONDS))
        session.ended_at = now
        session.note = note or session.note
        if session.duration_seconds >= 60:
            log(
                db,
                "session",
                subject_id=session.subject_id,
                node_id=session.node_id,
                minutes=session.duration_seconds // 60,
            )
    return session


def active_session(db: Session) -> StudySession | None:
    return db.scalar(
        select(StudySession)
        .where(StudySession.ended_at.is_(None))
        .order_by(StudySession.started_at.desc())
    )


def minutes_by_node(db: Session, node_ids: list[int]) -> dict[int, int]:
    if not node_ids:
        return {}
    rows = db.execute(
        select(StudySession.node_id, func.sum(StudySession.duration_seconds))
        .where(StudySession.node_id.in_(node_ids), StudySession.ended_at.is_not(None))
        .group_by(StudySession.node_id)
    ).all()
    return {nid: int((secs or 0) // 60) for nid, secs in rows}
