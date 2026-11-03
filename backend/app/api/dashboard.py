from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import DB, CurrentUser
from app.models.plan import Plan, PlanNode
from app.models.subject import Subject
from app.services.graph import compute_progress, compute_states, status_of

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class DashboardNode(BaseModel):
    node_id: int
    key: str
    title: str
    estimated_minutes: int
    difficulty: int | None
    status: str
    plan_id: int
    plan_title: str
    subject_id: int
    subject_name: str
    subject_color: str


class DashboardExam(BaseModel):
    plan_id: int
    plan_title: str
    subject_id: int
    subject_name: str
    subject_color: str
    exam_date: date
    exam_name: str | None
    days_left: int
    percent: float
    minutes_remaining: int


class DashboardOut(BaseModel):
    subjects_count: int
    plans_count: int
    nodes_total: int
    nodes_done: int
    exams: list[DashboardExam]
    ready: list[DashboardNode]
    in_progress: list[DashboardNode]


@router.get("", response_model=DashboardOut)
def dashboard(db: DB, user: CurrentUser) -> DashboardOut:
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
    exams: list[DashboardExam] = []
    ready: list[DashboardNode] = []
    in_progress: list[DashboardNode] = []
    nodes_total = nodes_done = plans_count = 0

    def to_node(n: PlanNode, plan: Plan, subject: Subject) -> DashboardNode:
        return DashboardNode(
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
            if plan.exam_date and plan.exam_date >= today:
                exams.append(
                    DashboardExam(
                        plan_id=plan.id,
                        plan_title=plan.title,
                        subject_id=subject.id,
                        subject_name=subject.name,
                        subject_color=subject.color,
                        exam_date=plan.exam_date,
                        exam_name=plan.exam_name,
                        days_left=(plan.exam_date - today).days,
                        percent=progress.percent,
                        minutes_remaining=progress.minutes_total - progress.minutes_done,
                    )
                )
            for n in sorted(active, key=lambda n: n.sort_order):
                st = states[n.id]
                if st.status == "in_progress":
                    in_progress.append(to_node(n, plan, subject))
                elif st.ready:
                    ready.append(to_node(n, plan, subject))

    exams.sort(key=lambda e: e.exam_date)
    return DashboardOut(
        subjects_count=len(subjects),
        plans_count=plans_count,
        nodes_total=nodes_total,
        nodes_done=nodes_done,
        exams=exams,
        ready=ready[:12],
        in_progress=in_progress[:12],
    )
