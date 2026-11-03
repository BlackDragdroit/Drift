"""Import learning plans: parse -> validate -> preview diff -> apply (create or merge).

Merge semantics (see docs/plan-format.md):
  * nodes are matched by their `id` (stored as PlanNode.key)
  * content fields are overwritten, prerequisite edges replaced
  * progress, notes, attempts and user-created flashcards are never touched
  * nodes missing from the new file are archived (default) or deleted
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.base import utcnow
from app.models.exercise import Exercise, ExerciseNodeLink, ExercisePart
from app.models.plan import Flashcard, NodePrerequisite, NodeProgress, Note, Plan, PlanNode
from app.models.subject import Subject
from app.schemas.plan_format import ExerciseSpec, NodeSpec, PlanSpec
from app.services.plan_markdown import looks_like_markdown, markdown_to_plan
from app.services.plan_validation import Issue, ValidationResult, validate_plan

Format = Literal["auto", "json", "markdown"]


class ImportError_(Exception):
    def __init__(self, message: str, issues: list[Issue] | None = None) -> None:
        super().__init__(message)
        self.issues = issues or [Issue("$", message)]


def parse_content(text: str, fmt: Format = "auto") -> tuple[dict[str, Any], str]:
    """Returns (raw document, detected format)."""
    text = text.lstrip("\ufeff")
    if fmt == "markdown" or (fmt == "auto" and looks_like_markdown(text)):
        return markdown_to_plan(text), "markdown"
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ImportError_(
            f"Invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}."
        ) from exc
    if not isinstance(raw, dict):
        raise ImportError_("The JSON document must be an object with 'title' and 'nodes'.")
    return raw, "json"


def validate_text(text: str, fmt: Format = "auto") -> tuple[ValidationResult, str]:
    raw, detected = parse_content(text, fmt)
    return validate_plan(raw), detected


# --------------------------------------------------------------------------- diff / preview


@dataclass
class NodeDiff:
    key: str
    title: str
    change: Literal["added", "changed", "unchanged", "removed"]
    fields: list[str] = field(default_factory=list)
    has_progress: bool = False
    has_note: bool = False


@dataclass
class ImportPreview:
    mode: Literal["create", "merge"]
    plan_key: str
    plan_title: str
    existing_plan_id: int | None
    nodes: list[NodeDiff]
    exercises: int
    flashcards: int
    has_progress_block: bool
    has_notes_block: bool

    @property
    def counts(self) -> dict[str, int]:
        out = {"added": 0, "changed": 0, "unchanged": 0, "removed": 0}
        for n in self.nodes:
            out[n.change] += 1
        return out

    def as_dict(self) -> dict[str, Any]:
        return {**asdict(self), "counts": self.counts}


def _node_fingerprint(spec: NodeSpec) -> dict[str, Any]:
    return {
        "title": spec.title,
        "parent": spec.parent,
        "description": spec.description,
        "objectives": list(spec.objectives),
        "estimated_minutes": spec.estimated_minutes,
        "difficulty": spec.difficulty,
        "prerequisites": sorted((p.id, p.kind) for p in spec.prerequisites),
        "resources": [r.model_dump(exclude_none=True) for r in spec.resources],
        "keywords": list(spec.keywords),
    }


def _db_fingerprint(node: PlanNode, key_of: dict[int, str]) -> dict[str, Any]:
    return {
        "title": node.title,
        "parent": key_of.get(node.parent_id) if node.parent_id else None,
        "description": node.description,
        "objectives": list(node.objectives or []),
        "estimated_minutes": node.estimated_minutes,
        "difficulty": node.difficulty,
        "prerequisites": sorted(
            (key_of[p.prerequisite_id], p.kind)
            for p in node.prerequisites
            if p.prerequisite_id in key_of
        ),
        "resources": [
            {k: v for k, v in r.items() if v is not None} for r in (node.resources or [])
        ],
        "keywords": list(node.keywords or []),
    }


def load_plan(db: Session, plan_id: int) -> Plan | None:
    return db.scalar(
        select(Plan)
        .options(
            selectinload(Plan.subject),
            selectinload(Plan.nodes)
            .selectinload(PlanNode.prerequisites)
            .selectinload(NodePrerequisite.prerequisite),
            selectinload(Plan.nodes).selectinload(PlanNode.progress),
            selectinload(Plan.nodes).selectinload(PlanNode.note),
            selectinload(Plan.nodes).selectinload(PlanNode.flashcards),
            selectinload(Plan.nodes).selectinload(PlanNode.children),
        )
        .where(Plan.id == plan_id)
        .execution_options(populate_existing=True)
    )


def find_existing_plan(db: Session, subject_id: int, key: str) -> Plan | None:
    plan = db.scalar(select(Plan).where(Plan.subject_id == subject_id, Plan.key == key))
    return load_plan(db, plan.id) if plan else None


def resolve_target_plan(
    db: Session, spec: PlanSpec, subject_id: int, plan_id: int | None
) -> Plan | None:
    if plan_id is not None:
        plan = load_plan(db, plan_id)
        if plan is None or plan.subject_id != subject_id:
            raise ImportError_("The plan to update does not exist in this subject.")
        return plan
    return find_existing_plan(db, subject_id, spec.id or "")


def preview_import(
    db: Session, spec: PlanSpec, subject_id: int, plan_id: int | None = None
) -> ImportPreview:
    existing = resolve_target_plan(db, spec, subject_id, plan_id)
    plan_key = spec.id or (existing.key if existing else "plan")
    diffs: list[NodeDiff] = []
    if existing is None:
        diffs = [NodeDiff(n.id, n.title, "added") for n in spec.nodes]
    else:
        key_of = {n.id: n.key for n in existing.nodes}
        by_key = {n.key: n for n in existing.nodes}
        for n in spec.nodes:
            cur = by_key.get(n.id)
            if cur is None:
                diffs.append(NodeDiff(n.id, n.title, "added"))
                continue
            a, b = _node_fingerprint(n), _db_fingerprint(cur, key_of)
            changed = [k for k in a if a[k] != b[k]]
            if cur.archived:
                changed.append("restored")
            diffs.append(
                NodeDiff(
                    n.id,
                    n.title,
                    "changed" if changed else "unchanged",
                    changed,
                    has_progress=bool(cur.progress and cur.progress.status != "not_started"),
                    has_note=bool(cur.note and cur.note.content.strip()),
                )
            )
        spec_keys = {n.id for n in spec.nodes}
        for cur in existing.nodes:
            if cur.key not in spec_keys and not cur.archived:
                diffs.append(
                    NodeDiff(
                        cur.key,
                        cur.title,
                        "removed",
                        has_progress=bool(cur.progress and cur.progress.status != "not_started"),
                        has_note=bool(cur.note and cur.note.content.strip()),
                    )
                )
    return ImportPreview(
        mode="merge" if existing else "create",
        plan_key=plan_key,
        plan_title=spec.title,
        existing_plan_id=existing.id if existing else None,
        nodes=diffs,
        exercises=sum(len(n.exercises) for n in spec.nodes),
        flashcards=sum(len(n.flashcards) for n in spec.nodes),
        has_progress_block=bool(spec.progress),
        has_notes_block=bool(spec.notes),
    )


# --------------------------------------------------------------------------- apply


@dataclass
class ImportOptions:
    removed_nodes: Literal["archive", "delete"] = "archive"
    import_progress: bool = False
    import_notes: bool = False
    overwrite_existing_progress: bool = False


def apply_import(
    db: Session,
    spec: PlanSpec,
    subject: Subject,
    plan_id: int | None = None,
    options: ImportOptions | None = None,
) -> Plan:
    options = options or ImportOptions()
    plan = resolve_target_plan(db, spec, subject.id, plan_id)
    now = utcnow()

    if plan is None:
        plan = Plan(subject_id=subject.id, key=spec.id or "plan")
        db.add(plan)
    elif spec.id and spec.id != plan.key and find_existing_plan(db, subject.id, spec.id) is None:
        plan.key = spec.id

    plan.title = spec.title
    plan.description = spec.description
    plan.language = spec.language
    plan.exam_date = spec.exam.date if spec.exam else plan.exam_date
    plan.exam_name = spec.exam.name if spec.exam else plan.exam_name
    plan.tags = list(spec.tags)
    plan.resources = [r.model_dump(exclude_none=True) for r in spec.resources]
    plan.meta = dict(spec.meta)
    plan.schema_version = spec.schema_version
    plan.last_imported_at = now
    db.flush()

    existing_by_key = {n.key: n for n in plan.nodes}
    spec_keys = {n.id for n in spec.nodes}

    # 1. upsert nodes (content only)
    nodes_by_key: dict[str, PlanNode] = {}
    for index, n in enumerate(spec.nodes):
        node = existing_by_key.get(n.id)
        if node is None:
            node = PlanNode(plan_id=plan.id, key=n.id)
            db.add(node)
        node.title = n.title
        node.description = n.description
        node.objectives = list(n.objectives)
        node.estimated_minutes = n.estimated_minutes
        node.difficulty = n.difficulty
        node.resources = [r.model_dump(exclude_none=True) for r in n.resources]
        node.keywords = list(n.keywords)
        node.sort_order = index
        node.archived = False
        nodes_by_key[n.id] = node
    db.flush()

    # 2. hierarchy + prerequisite edges
    for n in spec.nodes:
        node = nodes_by_key[n.id]
        node.parent_id = (
            nodes_by_key[n.parent].id if n.parent and n.parent in nodes_by_key else None
        )
        node.prerequisites.clear()
        for p in n.prerequisites:
            if p.id in nodes_by_key:
                node.prerequisites.append(
                    NodePrerequisite(
                        prerequisite_id=nodes_by_key[p.id].id, kind=p.kind, note=p.note
                    )
                )

    # 3. removed nodes
    for key, node in existing_by_key.items():
        if key in spec_keys:
            continue
        if options.removed_nodes == "delete":
            db.delete(node)
        else:
            node.archived = True
            for child in node.children:
                if child.key in spec_keys:
                    child.parent_id = None

    # 4. flashcards / exercises embedded in nodes
    for n in spec.nodes:
        _sync_flashcards(db, nodes_by_key[n.id], n)
        _sync_exercises(db, plan, subject, nodes_by_key[n.id], n)

    # 5. optional progress / notes blocks
    if options.import_progress and spec.progress:
        for key, entry in spec.progress.items():
            node = nodes_by_key.get(key)
            if node is None:
                continue
            if node.progress is None:
                node.progress = NodeProgress(status="not_started")
            if node.progress.status == "not_started" or options.overwrite_existing_progress:
                set_status(node, entry.status, at=entry.updated_at)
    if options.import_notes and spec.notes:
        for key, content in spec.notes.items():
            node = nodes_by_key.get(key)
            if node is None or not content.strip():
                continue
            if node.note is None:
                node.note = Note(content=content)
            elif not node.note.content.strip():
                node.note.content = content

    db.commit()
    return load_plan(db, plan.id)  # type: ignore[return-value]


def set_status(node: PlanNode, status: str, at=None) -> NodeProgress:
    at = at or utcnow()
    if at.tzinfo is not None:
        at = at.astimezone(tz=None).replace(tzinfo=None)
    if node.progress is None:
        node.progress = NodeProgress(status="not_started")
    p = node.progress
    p.status = status
    if status == "not_started":
        p.started_at = p.understood_at = p.mastered_at = None
    else:
        p.started_at = p.started_at or at
        if status == "in_progress":
            p.understood_at = p.mastered_at = None
        elif status == "understood":
            p.understood_at = p.understood_at or at
            p.mastered_at = None
        elif status == "mastered":
            p.understood_at = p.understood_at or at
            p.mastered_at = p.mastered_at or at
    p.updated_at = utcnow()
    return p


def _sync_flashcards(db: Session, node: PlanNode, spec: NodeSpec) -> None:
    managed = {c.key: c for c in node.flashcards if c.key}
    seen: set[str] = set()
    for i, card in enumerate(spec.flashcards):
        key = card.id or f"fc-{i + 1}"
        seen.add(key)
        cur = managed.get(key)
        if cur is None:
            node.flashcards.append(Flashcard(key=key, front=card.front, back=card.back))
        else:
            cur.front, cur.back = card.front, card.back
    for key, cur in managed.items():
        if key not in seen:
            db.delete(cur)


def _exercise_key(node_key: str, ex: ExerciseSpec, index: int) -> str:
    return f"{node_key}/{ex.id or f'ex-{index + 1}'}"


def _sync_exercises(
    db: Session, plan: Plan, subject: Subject, node: PlanNode, spec: NodeSpec
) -> None:
    prefix = f"{node.key}/"
    existing = {
        e.key: e
        for e in db.scalars(
            select(Exercise)
            .options(
                selectinload(Exercise.parts),
                selectinload(Exercise.attempts),
                selectinload(Exercise.node_links),
            )
            .where(Exercise.plan_id == plan.id)
        )
        if e.key and e.key.startswith(prefix)
    }
    seen: set[str] = set()
    for i, ex in enumerate(spec.exercises):
        key = _exercise_key(node.key, ex, i)
        seen.add(key)
        cur = existing.get(key)
        if cur is None:
            cur = Exercise(subject_id=subject.id, plan_id=plan.id, key=key)
            db.add(cur)
        cur.number = ex.number
        cur.title = ex.title or (
            f"Exercise {ex.number}" if ex.number else f"{node.title} – exercise {i + 1}"
        )
        cur.statement = ex.statement
        cur.hints = list(ex.hints)
        cur.solution = ex.solution
        cur.difficulty = ex.difficulty
        cur.source_label = f"Plan: {plan.title}"
        cur.parts = [
            ExercisePart(
                label=p.label,
                statement=p.statement,
                hints=list(p.hints),
                solution=p.solution,
                sort_order=j,
            )
            for j, p in enumerate(ex.parts)
        ]
        db.flush()
        if not any(link.node_id == node.id for link in cur.node_links):
            cur.node_links.append(ExerciseNodeLink(node_id=node.id))
    for key, cur in existing.items():
        if key not in seen and not cur.attempts:
            db.delete(cur)
