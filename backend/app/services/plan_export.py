from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.exercise import Exercise, ExerciseNodeLink
from app.models.plan import Plan, PlanNode
from app.schemas.plan_format import SCHEMA_VERSION


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}


def export_plan(
    db: Session, plan: Plan, include_progress: bool = False, include_notes: bool = False
) -> dict[str, Any]:
    nodes = [n for n in plan.nodes if not n.archived]
    key_of = {n.id: n.key for n in nodes}
    node_ids = [n.id for n in nodes]
    exercises_by_node: dict[int, list[Exercise]] = {}
    if node_ids:
        rows = db.execute(
            select(ExerciseNodeLink.node_id, Exercise)
            .join(Exercise, Exercise.id == ExerciseNodeLink.exercise_id)
            .options(selectinload(Exercise.parts))
            .where(ExerciseNodeLink.node_id.in_(node_ids), Exercise.plan_id == plan.id)
        ).all()
        for node_id, ex in rows:
            exercises_by_node.setdefault(node_id, []).append(ex)

    out_nodes = []
    for n in nodes:
        prefix = f"{n.key}/"
        exercises = [
            _clean(
                {
                    "id": ex.key[len(prefix) :] if ex.key and ex.key.startswith(prefix) else None,
                    "number": ex.number,
                    "title": ex.title,
                    "statement": ex.statement,
                    "parts": [
                        _clean(
                            {
                                "label": p.label,
                                "statement": p.statement,
                                "hints": p.hints,
                                "solution": p.solution,
                            }
                        )
                        for p in ex.parts
                    ],
                    "hints": ex.hints,
                    "solution": ex.solution,
                    "difficulty": ex.difficulty,
                }
            )
            for ex in sorted(exercises_by_node.get(n.id, []), key=lambda e: e.key or "")
        ]
        out_nodes.append(
            _clean(
                {
                    "id": n.key,
                    "title": n.title,
                    "parent": key_of.get(n.parent_id) if n.parent_id else None,
                    "description": n.description,
                    "objectives": n.objectives,
                    "estimatedMinutes": n.estimated_minutes,
                    "difficulty": n.difficulty,
                    "prerequisites": [
                        p.prerequisite.key
                        if p.kind == "required" and not p.note
                        else _clean({"id": p.prerequisite.key, "kind": p.kind, "note": p.note})
                        for p in n.prerequisites
                        if p.prerequisite_id in key_of
                    ],
                    "resources": n.resources,
                    "keywords": n.keywords,
                    "flashcards": [
                        _clean({"id": c.key, "front": c.front, "back": c.back})
                        for c in n.flashcards
                        if c.key
                    ],
                    "exercises": exercises,
                }
            )
        )

    doc: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "id": plan.key,
        "title": plan.title,
        "subject": plan.subject.name,
        "language": plan.language,
        "description": plan.description,
        "exam": _clean({"date": plan.exam_date.isoformat(), "name": plan.exam_name})
        if plan.exam_date
        else None,
        "tags": plan.tags,
        "resources": plan.resources,
        "meta": plan.meta,
        "nodes": out_nodes,
    }
    if include_progress:
        doc["progress"] = {
            n.key: {
                "status": n.progress.status,
                "updatedAt": n.progress.updated_at.isoformat() + "Z",
            }
            for n in nodes
            if n.progress and n.progress.status != "not_started"
        }
    if include_notes:
        doc["notes"] = {n.key: n.note.content for n in nodes if n.note and n.note.content.strip()}
    return _clean(doc) | {"schemaVersion": SCHEMA_VERSION, "nodes": out_nodes}


def node_sort_key(node: PlanNode) -> int:
    return node.sort_order
