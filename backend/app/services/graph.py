"""Pure graph computations over plan nodes: readiness, blocking prerequisites, aggregated progress."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from app.models.plan import DONE_STATUSES, PlanNode

DEFAULT_MINUTES = 30  # used for nodes without an estimate when weighting progress / scheduling


@dataclass
class NodeState:
    status: str
    ready: bool
    blocked_by: list[str] = field(
        default_factory=list
    )  # keys of required prerequisites not yet done
    descendants_total: int = 0
    descendants_done: int = 0


@dataclass
class PlanProgress:
    nodes_total: int
    nodes_done: int
    nodes_in_progress: int
    minutes_total: int
    minutes_done: int
    ready_count: int

    @property
    def percent(self) -> float:
        if self.minutes_total > 0:
            return round(100 * self.minutes_done / self.minutes_total, 1)
        return round(100 * self.nodes_done / self.nodes_total, 1) if self.nodes_total else 0.0

    def as_dict(self) -> dict[str, float | int]:
        return {
            "nodes_total": self.nodes_total,
            "nodes_done": self.nodes_done,
            "nodes_in_progress": self.nodes_in_progress,
            "minutes_total": self.minutes_total,
            "minutes_done": self.minutes_done,
            "ready_count": self.ready_count,
            "percent": self.percent,
        }


def status_of(node: PlanNode) -> str:
    return node.progress.status if node.progress else "not_started"


def is_done(node: PlanNode) -> bool:
    return status_of(node) in DONE_STATUSES


def effective_minutes(node: PlanNode, has_children: bool) -> int:
    if node.estimated_minutes > 0:
        return node.estimated_minutes
    return 0 if has_children else DEFAULT_MINUTES


def compute_states(nodes: Iterable[PlanNode]) -> dict[int, NodeState]:
    active = [n for n in nodes if not n.archived]
    by_id = {n.id: n for n in active}
    children: dict[int | None, list[PlanNode]] = {}
    for n in active:
        children.setdefault(n.parent_id, []).append(n)

    states: dict[int, NodeState] = {}
    for n in active:
        blocked = [
            by_id[p.prerequisite_id].key
            for p in n.prerequisites
            if p.kind == "required"
            and p.prerequisite_id in by_id
            and not is_done(by_id[p.prerequisite_id])
        ]
        # Grouping nodes (with children) are never "ready" themselves; their children are.
        is_leaf = not children.get(n.id)
        states[n.id] = NodeState(
            status=status_of(n),
            ready=is_leaf and status_of(n) == "not_started" and not blocked,
            blocked_by=blocked,
        )

    def aggregate(node: PlanNode) -> tuple[int, int]:
        total = done = 0
        for child in children.get(node.id, []):
            t, d = aggregate(child)
            total += t + 1
            done += d + (1 if is_done(child) else 0)
        states[node.id].descendants_total = total
        states[node.id].descendants_done = done
        return total, done

    for root in children.get(None, []):
        aggregate(root)
    # Nodes whose parent is archived/missing still need aggregation
    for n in active:
        if n.parent_id is not None and n.parent_id not in by_id:
            aggregate(n)
    return states


def compute_progress(
    nodes: Iterable[PlanNode], states: dict[int, NodeState] | None = None
) -> PlanProgress:
    active = [n for n in nodes if not n.archived]
    states = states or compute_states(active)
    has_children = {n.parent_id for n in active if n.parent_id is not None}
    minutes_total = minutes_done = 0
    for n in active:
        m = effective_minutes(n, n.id in has_children)
        minutes_total += m
        if is_done(n):
            minutes_done += m
    return PlanProgress(
        nodes_total=len(active),
        nodes_done=sum(1 for n in active if is_done(n)),
        nodes_in_progress=sum(1 for n in active if status_of(n) == "in_progress"),
        minutes_total=minutes_total,
        minutes_done=minutes_done,
        ready_count=sum(1 for n in active if states[n.id].ready),
    )


def topological_order(nodes: Iterable[PlanNode]) -> list[PlanNode]:
    """Kahn's algorithm over prerequisite edges; ties broken by plan order. Cycles fall back to plan order."""
    active = sorted((n for n in nodes if not n.archived), key=lambda n: n.sort_order)
    by_id = {n.id: n for n in active}
    indegree = {n.id: 0 for n in active}
    dependents: dict[int, list[int]] = {n.id: [] for n in active}
    for n in active:
        for p in n.prerequisites:
            if p.prerequisite_id in by_id:
                indegree[n.id] += 1
                dependents[p.prerequisite_id].append(n.id)
    ready = [n.id for n in active if indegree[n.id] == 0]
    order: list[PlanNode] = []
    while ready:
        ready.sort(key=lambda i: by_id[i].sort_order)
        cur = ready.pop(0)
        order.append(by_id[cur])
        for d in dependents[cur]:
            indegree[d] -= 1
            if indegree[d] == 0:
                ready.append(d)
    if len(order) < len(active):
        seen = {n.id for n in order}
        order.extend(n for n in active if n.id not in seen)
    return order
