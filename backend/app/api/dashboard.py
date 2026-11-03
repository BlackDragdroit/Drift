from datetime import date

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.sessions import session_out
from app.core.deps import DB, CurrentUser
from app.models.exercise import Attempt, Exercise, ExerciseNodeLink
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.schemas.api import (
    DashboardExamOut,
    DashboardNodeOut,
    DashboardOut,
    RetryExerciseOut,
    StreakOut,
    WeakSpotOut,
)
from app.services import activity
from app.services.flashcards import due_counts
from app.services.graph import compute_progress, compute_states, status_of
from app.services.schedule import build_schedule

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardOut)
def dashboard(
    db: DB,
    user: CurrentUser,
    tz_offset: int = Query(
        0,
        ge=-840,
        le=840,
        description="Local timezone offset in minutes (JS getTimezoneOffset() * -1)",
    ),
) -> DashboardOut:
    subjects = list(
        db.scalars(
            select(Subject)
            .options(
                selectinload(Subject.plans)
                .selectinload(Plan.nodes)
                .selectinload(PlanNode.prerequisites),
                selectinload(Subject.plans)
                .selectinload(Plan.nodes)
                .selectinload(PlanNode.progress),
            )
            .where(Subject.user_id == user.id, Subject.archived.is_(False))
            .order_by(Subject.sort_order)
        )
    )
    today = date.today()
    exams: list[DashboardExamOut] = []
    ready: list[DashboardNodeOut] = []
    in_progress: list[DashboardNodeOut] = []
    due_today: list[DashboardNodeOut] = []
    nodes_total = nodes_done = plans_count = 0

    def to_node(n: PlanNode, plan: Plan, subject: Subject) -> DashboardNodeOut:
        return DashboardNodeOut(
            node_id=n.id,
            key=n.key,
            title=n.title,
            estimated_minutes=n.estimated_minutes,
            difficulty=n.difficulty,
            status=status_of(n),
            plan_id=plan.id,
            plan_title=plan.title,
            subject_id=subject.id,
            subject_name=subject.name,
            subject_color=subject.color,
        )

    for subject in subjects:
        for plan in subject.plans:
            plans_count += 1
            active = [n for n in plan.nodes if not n.archived]
            states = compute_states(active)
            progress = compute_progress(active, states)
            nodes_total += progress.nodes_total
            nodes_done += progress.nodes_done
            by_id = {n.id: n for n in active}
            if plan.exam_date and plan.exam_date >= today:
                schedule = build_schedule(plan, today)
                s = schedule.summary
                exams.append(
                    DashboardExamOut(
                        plan_id=plan.id,
                        plan_title=plan.title,
                        subject_id=subject.id,
                        subject_name=subject.name,
                        subject_color=subject.color,
                        exam_date=plan.exam_date,
                        exam_name=plan.exam_name,
                        days_left=(plan.exam_date - today).days,
                        percent=progress.percent,
                        minutes_remaining=s.remaining_minutes,
                        needed_per_day=s.needed_per_day,
                        capacity_minutes=s.capacity_minutes,
                        behind=s.behind,
                    )
                )
                if schedule.days and schedule.days[0].date == today:
                    due_today.extend(
                        to_node(by_id[sn.node_id], plan, subject)
                        for sn in schedule.days[0].nodes
                        if sn.node_id in by_id
                    )
            for n in sorted(active, key=lambda n: n.sort_order):
                st = states[n.id]
                if st.status == "in_progress":
                    in_progress.append(to_node(n, plan, subject))
                elif st.ready:
                    ready.append(to_node(n, plan, subject))

    exams.sort(key=lambda e: e.exam_date)
    due_ids = {n.node_id for n in due_today}
    ready = [n for n in ready if n.node_id not in due_ids]
    in_progress = [n for n in in_progress if n.node_id not in due_ids]

    streak = activity.streak(db, tz_offset)
    spots = activity.weak_spots(db)

    # exercises whose latest attempt failed/partial -> "retry these"
    latest = (
        select(Attempt.exercise_id, func.max(Attempt.created_at).label("latest"))
        .group_by(Attempt.exercise_id)
        .subquery()
    )
    retry_rows = db.execute(
        select(Exercise, Attempt.result, Subject.name, Subject.color)
        .join(latest, latest.c.exercise_id == Exercise.id)
        .join(
            Attempt, (Attempt.exercise_id == Exercise.id) & (Attempt.created_at == latest.c.latest)
        )
        .join(Subject, Subject.id == Exercise.subject_id)
        .where(Subject.user_id == user.id, Attempt.result.in_(("failed", "partial")))
        .order_by(latest.c.latest.desc())
        .limit(8)
    ).all()
    retry_ids = [r[0].id for r in retry_rows]
    key_rows = (
        db.execute(
            select(ExerciseNodeLink.exercise_id, PlanNode.key)
            .join(PlanNode, PlanNode.id == ExerciseNodeLink.node_id)
            .where(ExerciseNodeLink.exercise_id.in_(retry_ids))
        ).all()
        if retry_ids
        else []
    )
    keys: dict[int, list[str]] = {}
    for ex_id, key in key_rows:
        keys.setdefault(ex_id, []).append(key)
    retry = [
        RetryExerciseOut(
            id=ex.id,
            title=ex.title,
            number=ex.number,
            subject_id=ex.subject_id,
            subject_name=sname,
            subject_color=scolor,
            last_result=result,
            node_keys=keys.get(ex.id, []),
        )
        for ex, result, sname, scolor in retry_rows
    ]
    exercises_total = (
        db.scalar(select(func.count(Exercise.id)).join(Subject).where(Subject.user_id == user.id))
        or 0
    )
    active_session = activity.active_session(db)
    cards = due_counts(db, user.id)

    return DashboardOut(
        flashcards_due=cards["due"],
        flashcards_new=cards["new"],
        subjects_count=len(subjects),
        plans_count=plans_count,
        nodes_total=nodes_total,
        nodes_done=nodes_done,
        exercises_total=exercises_total,
        exams=exams,
        due_today=due_today[:12],
        ready=ready[:12],
        in_progress=in_progress[:12],
        streak=StreakOut(**streak.__dict__),
        weak_spots=[WeakSpotOut(**w.__dict__) for w in spots],
        retry_exercises=retry,
        active_session=session_out(db, active_session) if active_session else None,
    )
