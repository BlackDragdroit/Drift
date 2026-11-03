"""Stateless study scheduler.

Given a plan (nodes, prerequisites, progress), an optional exam date and a daily capacity, it
distributes the remaining work over the available days. Because it is recomputed on every request,
falling behind simply re-spreads the remaining minutes over the remaining days; the summary flags
when that would exceed the configured capacity.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from app.models.plan import Plan, PlanNode
from app.services.graph import effective_minutes, is_done, status_of, topological_order

REVIEW_BUFFER_DAYS = 1  # last day before the exam is kept free for review when there is slack
MAX_HORIZON_DAYS = 365


@dataclass
class ScheduledNode:
    node_id: int
    key: str
    title: str
    minutes: int
    status: str
    ready: bool


@dataclass
class ScheduleDay:
    date: date
    minutes: int
    nodes: list[ScheduledNode] = field(default_factory=list)


@dataclass
class ScheduleSummary:
    exam_date: date | None
    days_left: int | None
    study_days: int
    remaining_minutes: int
    remaining_nodes: int
    capacity_minutes: int
    needed_per_day: int
    behind: bool
    finish_date: date | None
    in_progress: int


@dataclass
class Schedule:
    summary: ScheduleSummary
    days: list[ScheduleDay]


def build_schedule(plan: Plan, today: date | None = None) -> Schedule:
    today = today or date.today()
    active = [n for n in plan.nodes if not n.archived]
    has_children = {n.parent_id for n in active if n.parent_id is not None}
    by_id = {n.id: n for n in active}

    def is_unit(n: PlanNode) -> bool:
        return effective_minutes(n, n.id in has_children) > 0

    remaining = [n for n in topological_order(active) if is_unit(n) and not is_done(n)]
    # Things already started come first within the prerequisite order.
    remaining.sort(
        key=lambda n: 0 if status_of(n) == "in_progress" else 1,
    )  # stable sort keeps topo order
    remaining_minutes = sum(effective_minutes(n, n.id in has_children) for n in remaining)
    capacity = max(15, plan.daily_capacity_minutes or 120)

    def ready(n: PlanNode) -> bool:
        return all(
            is_done(by_id[p.prerequisite_id])
            for p in n.prerequisites
            if p.kind == "required" and p.prerequisite_id in by_id
        )

    exam = plan.exam_date
    days_left = (exam - today).days if exam else None
    if exam and days_left is not None and days_left >= 0:
        study_days = max(1, days_left - (REVIEW_BUFFER_DAYS if days_left > 3 else 0))
        needed = -(-remaining_minutes // study_days) if remaining_minutes else 0  # ceil
        per_day = max(needed, 15)
        behind = needed > capacity
        # When behind, we still show the honest "needed" pace rather than silently overflowing past the exam.
    else:
        study_days = (
            min(MAX_HORIZON_DAYS, max(1, -(-remaining_minutes // capacity)))
            if remaining_minutes
            else 1
        )
        per_day = capacity
        needed = capacity if remaining_minutes else 0
        behind = False

    days: list[ScheduleDay] = []
    cursor = today
    load = 0
    current = ScheduleDay(date=cursor, minutes=0)
    for n in remaining:
        m = effective_minutes(n, n.id in has_children)
        # Start a new day when this node does not fit, unless the day is still empty.
        if current.nodes and load + m > per_day and len(days) < MAX_HORIZON_DAYS:
            days.append(current)
            cursor += timedelta(days=1)
            current = ScheduleDay(date=cursor, minutes=0)
            load = 0
        current.nodes.append(ScheduledNode(n.id, n.key, n.title, m, status_of(n), ready(n)))
        current.minutes += m
        load += m
    if current.nodes:
        days.append(current)

    finish = days[-1].date if days else None
    summary = ScheduleSummary(
        exam_date=exam,
        days_left=days_left,
        study_days=study_days,
        remaining_minutes=remaining_minutes,
        remaining_nodes=len(remaining),
        capacity_minutes=capacity,
        needed_per_day=needed,
        behind=behind,
        finish_date=finish,
        in_progress=sum(1 for n in remaining if status_of(n) == "in_progress"),
    )
    return Schedule(summary=summary, days=days)


def due_today(plan: Plan, today: date | None = None) -> list[ScheduledNode]:
    today = today or date.today()
    schedule = build_schedule(plan, today)
    return schedule.days[0].nodes if schedule.days and schedule.days[0].date == today else []
