"""Formula sheet: curated per-plan list of formulas, grouped by topic.

Entries are plain rows the student writes while working through exercises; the only AI part is
`harvest`, which proposes formulas that literally appear in given material (an exercise's solution
or a topic's text) so the student can tick the ones worth keeping. Proposals are never saved here.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.exercise import Exercise, ExerciseNodeLink
from app.models.formula import FormulaEntry
from app.models.plan import Plan, PlanNode
from app.services import generation
from app.services.extraction import Usage
from app.services.generation import StructuredCaller, schema_for


def tree_order(nodes: Iterable[PlanNode]) -> list[PlanNode]:
    """Depth-first plan order (parents before children, siblings by sort_order), archived skipped."""
    active = [n for n in nodes if not n.archived]
    by_parent: dict[int | None, list[PlanNode]] = {}
    ids = {n.id for n in active}
    for n in active:
        parent = n.parent_id if n.parent_id in ids else None
        by_parent.setdefault(parent, []).append(n)
    out: list[PlanNode] = []

    def walk(parent: int | None) -> None:
        for n in sorted(by_parent.get(parent, []), key=lambda n: n.sort_order):
            out.append(n)
            walk(n.id)

    walk(None)
    return out


def ordered_entries(db: Session, plan: Plan) -> list[FormulaEntry]:
    """All entries of the plan: grouped by topic in tree order, unassigned last, then sort_order."""
    rank = {n.id: i for i, n in enumerate(tree_order(plan.nodes))}
    entries = list(db.scalars(select(FormulaEntry).where(FormulaEntry.plan_id == plan.id)).all())
    entries.sort(
        key=lambda e: (
            rank.get(e.node_id, len(rank)) if e.node_id is not None else len(rank),
            e.sort_order,
            e.id,
        )
    )
    return entries


def next_sort_order(db: Session, plan_id: int, node_id: int | None) -> int:
    current = db.scalar(
        select(func.max(FormulaEntry.sort_order)).where(
            FormulaEntry.plan_id == plan_id, FormulaEntry.node_id.is_(node_id)
        )
        if node_id is None
        else select(func.max(FormulaEntry.sort_order)).where(
            FormulaEntry.plan_id == plan_id, FormulaEntry.node_id == node_id
        )
    )
    return (current if current is not None else -1) + 1


def reorder(db: Session, plan: Plan, ids: list[int]) -> None:
    """Assign consecutive sort_order to the given entries (ids not in the plan are ignored)."""
    own = {e.id: e for e in db.scalars(select(FormulaEntry).where(FormulaEntry.plan_id == plan.id))}
    for i, entry_id in enumerate(dict.fromkeys(ids)):
        if entry_id in own:
            own[entry_id].sort_order = i


def to_markdown(plan: Plan, entries: list[FormulaEntry], generated_at: datetime) -> str:
    """Printable sheet: `## Topic` per node, `**Title**` + formula + italic note per entry."""
    title_of = {n.id: n.title for n in plan.nodes}
    lines = [f"# {plan.title} — Formula sheet", ""]
    if plan.exam_name or plan.exam_date:
        exam = " · ".join(
            s for s in (plan.exam_name, plan.exam_date.isoformat() if plan.exam_date else None) if s
        )
        lines += [f"*{exam}*", ""]
    current: int | None | object = object()
    for e in entries:
        if e.node_id != current:
            current = e.node_id
            lines += [f"## {title_of.get(e.node_id, 'General') if e.node_id else 'General'}", ""]
        if e.title:
            lines.append(f"**{e.title}**")
            lines.append("")
        lines.append(e.content.strip())
        lines.append("")
        if e.note.strip():
            lines.append(f"*{e.note.strip()}*")
            lines.append("")
    lines.append(f"<!-- exported {generated_at.strftime('%Y-%m-%d %H:%M')} UTC -->")
    return "\n".join(lines).rstrip() + "\n"


# --- AI harvest ---------------------------------------------------------------------------------


class Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class FormulaOut(Strict):
    title: str = Field(
        description="Short name, e.g. 'Convolution integral' or 'Nyquist criterion'."
    )
    content: str = Field(
        description="The formula in LaTeX display math ($$...$$); several lines with aligned "
        "environments are fine. Define the symbols after it in one short Markdown line if needed."
    )
    note: str = Field(
        default="",
        description="When it applies / conditions / typical use, one sentence. Empty if obvious.",
    )


class FormulasOut(Strict):
    formulas: list[FormulaOut]


HARVEST_SYSTEM = """You compile formula sheets for a university student in medical engineering. From the given material, extract the formulas, definitions and key relations a student would want on a one-page cheat sheet for the exam. Rules: only formulas that actually appear in or are directly used by the material — never invent new ones; skip trivial arithmetic and intermediate numeric steps; merge duplicates; use the material's notation; write all mathematics in LaTeX ($$...$$ display math); keep the language of the material; do not repeat formulas that already exist on the sheet. Answer only with the JSON document."""


def exercise_material(ex: Exercise) -> str:
    parts = "\n".join(
        f"{p.label}) {p.statement}" + (f"\n   Solution: {p.solution}" if p.solution else "")
        for p in ex.parts
    )
    head = f"Exercise{f' {ex.number}' if ex.number else ''}: {ex.title}\n\n{ex.statement}"
    return "\n\n".join(
        s for s in (head, parts, f"Solution:\n{ex.solution}" if ex.solution else "") if s
    )


def node_material(db: Session, node: PlanNode) -> str:
    chunks = [
        f"Topic: {node.title}",
        f"Description:\n{node.description or '(none)'}",
    ]
    if node.objectives:
        chunks.append("Learning objectives:\n" + "\n".join(f"- {o}" for o in node.objectives))
    if node.note and node.note.content.strip():
        chunks.append(f"The student's own notes:\n{node.note.content[:4000]}")
    exercises = db.scalars(
        select(Exercise)
        .join(ExerciseNodeLink, ExerciseNodeLink.exercise_id == Exercise.id)
        .where(ExerciseNodeLink.node_id == node.id)
        .order_by(Exercise.id)
        .limit(8)
    ).all()
    for ex in exercises:
        if ex.solution or any(p.solution for p in ex.parts):
            chunks.append(exercise_material(ex))
    return "\n\n---\n\n".join(chunks)


def harvest_prompt(material: str, existing: list[str]) -> str:
    text = f"Material:\n\n{material[:16000]}"
    if existing:
        text += "\n\nAlready on the sheet (do not repeat):\n" + "\n".join(
            f"- {t}" for t in existing[:60]
        )
    return text + "\n\nExtract the formulas worth keeping (0 to 8)."


async def harvest(
    material: str, existing: list[str], caller: StructuredCaller | None = None
) -> tuple[list[FormulaOut], Usage]:
    caller = caller or generation.structured_call
    raw, usage = await caller(
        system=HARVEST_SYSTEM,
        user=harvest_prompt(material, existing),
        schema=schema_for(FormulasOut),
    )
    formulas = FormulasOut.model_validate(raw).formulas
    return [f for f in formulas if f.content.strip()][:8], usage
