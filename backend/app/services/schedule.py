"""Stateless study scheduler.

Given a plan (nodes, prerequisites, progress), an optional exam date and a daily capacity, it
distributes the remaining work over the available days. Because it is recomputed on every request,
falling behind simply re-spreads the remaining minutes over the remaining days; the summary flags
when that would exceed the configured capacity.

Long topics are split across consecutive days (part 1/2, ...) so a single 4-hour topic does not
push the whole plan past the exam. The daily pace is raised until the packed plan really ends
before the exam, so "on track" and the finish date can never contradict each other.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from app.models.plan import Plan, PlanNode
from app.services.graph import effective_minutes, is_done, status_of, topological_order

REVIEW_BUFFER_DAYS = 1  # last day before the exam is kept free for review when there is slack
MAX_HORIZON_DAYS = 365
SPLIT_THRESHOLD = 90  # topics longer than this may be split across days
MIN_CHUNK = 30  # never create a study chunk shorter than this
PACE_STEP = 15


@dataclass
class ScheduledNode:
    node_id: int
    key: str
    title: str
    minutes: int
    status: str
    ready: bool
    part: int | None = None  # 1-based chunk index when a topic is split across days
    parts: int | None = None


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


@dataclass
class _Unit:
    node: PlanNode
    minutes: int
    ready: bool


def _pack(units: list[_Unit], per_day: int, today: date) -> list[ScheduleDay]:
    """Sequentially pack units into days of `per_day` minutes, splitting long topics when needed."""
    days: list[ScheduleDay] = []
    current = ScheduleDay(date=today, minutes=0)
    chunks_of: dict[int, list[ScheduledNode]] = {}

    def new_day() -> None:
        nonlocal current
        days.append(current)
        current = ScheduleDay(date=current.date + timedelta(days=1), minutes=0)

    def place(u: _Unit, minutes: int) -> None:
        sn = ScheduledNode(u.node.id, u.node.key, u.node.title, minutes, status_of(u.node), u.ready)
        current.nodes.append(sn)
        current.minutes += minutes
        chunks_of.setdefault(u.node.id, []).append(sn)

    for u in units:
        left = u.minutes
        splittable = u.minutes > SPLIT_THRESHOLD
        while left > 0 and len(days) < MAX_HORIZON_DAYS:
            space = per_day - current.minutes
            empty = not current.nodes
            if left <= space or (empty and (left <= per_day or not splittable)):
                place(u, left)
                left = 0
            elif splittable and space >= MIN_CHUNK:
                chunk = space if left - space >= MIN_CHUNK else left  # avoid a tiny remainder
                place(u, chunk)
                left -= chunk
                if left > 0:
                    new_day()
            elif empty:  # per_day smaller than a chunk: put the whole thing here anyway
                place(u, left)
                left = 0
            else:
                new_day()
    if current.nodes:
        days.append(current)
    for chunks in chunks_of.values():
        if len(chunks) > 1:
            for i, sn in enumerate(chunks, start=1):
                sn.part, sn.parts = i, len(chunks)
    return days


def build_schedule(plan: Plan, today: date | None = None) -> Schedule:
    today = today or date.today()
    active = [n for n in plan.nodes if not n.archived]
    has_children = {n.parent_id for n in active if n.parent_id is not None}
    by_id = {n.id: n for n in active}

    def ready(n: PlanNode) -> bool:
        return all(
            is_done(by_id[p.prerequisite_id])
            for p in n.prerequisites
            if p.kind == "required" and p.prerequisite_id in by_id
        )

    remaining = [
        n
        for n in topological_order(active)
        if effective_minutes(n, n.id in has_children) > 0 and not is_done(n)
    ]
    # Things already started come first within the prerequisite order (stable sort keeps topo order).
    remaining.sort(key=lambda n: 0 if status_of(n) == "in_progress" else 1)
    units = [_Unit(n, effective_minutes(n, n.id in has_children), ready(n)) for n in remaining]
    remaining_minutes = sum(u.minutes for u in units)
    capacity = max(15, plan.daily_capacity_minutes or 120)

    exam = plan.exam_date
    days_left = (exam - today).days if exam else None
    paced_by_exam = exam is not None and days_left is not None and days_left >= 0

    if paced_by_exam:
        study_days = max(1, days_left - (REVIEW_BUFFER_DAYS if days_left > 3 else 0))
        per_day = (
            max(-(-remaining_minutes // study_days), PACE_STEP) if remaining_minutes else PACE_STEP
        )
        days = _pack(units, per_day, today)
        # Raise the pace until the packed plan really fits before the exam.
        while len(days) > study_days and per_day < 24 * 60:
            per_day += PACE_STEP
            days = _pack(units, per_day, today)
        needed = per_day if remaining_minutes else 0
        behind = needed > capacity
    else:
        per_day = capacity
        days = _pack(units, per_day, today)
        study_days = max(1, len(days))
        needed = capacity if remaining_minutes else 0
        behind = False

    summary = ScheduleSummary(
        exam_date=exam,
        days_left=days_left,
        study_days=study_days,
        remaining_minutes=remaining_minutes,
        remaining_nodes=len(units),
        capacity_minutes=capacity,
        needed_per_day=needed,
        behind=behind,
        finish_date=days[-1].date if days else None,
        in_progress=sum(1 for u in units if status_of(u.node) == "in_progress"),
    )
    return Schedule(summary=summary, days=days)


def due_today(plan: Plan, today: date | None = None) -> list[ScheduledNode]:
    today = today or date.today()
    schedule = build_schedule(plan, today)
    return schedule.days[0].nodes if schedule.days and schedule.days[0].date == today else []
