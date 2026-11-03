"""Builds the "Copy generation prompt" text for LLMs.

The field reference is generated from the pydantic models in app.schemas.plan_format,
so the prompt cannot drift from what the importer accepts.
"""

from __future__ import annotations

import json
from typing import Any, get_args, get_origin

from pydantic import BaseModel
from pydantic.fields import FieldInfo

from app.schemas.plan_format import (
    SCHEMA_VERSION,
    ExercisePartSpec,
    ExerciseSpec,
    FlashcardSpec,
    NodeSpec,
    PlanSpec,
    Prerequisite,
    Resource,
)

_SKIP_FIELDS = {("PlanSpec", "progress"), ("PlanSpec", "notes"), ("NodeSpec", "children")}


def _type_name(annotation: Any) -> str:
    origin = get_origin(annotation)
    if origin is None:
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            return annotation.__name__.replace("Spec", "")
        return getattr(annotation, "__name__", str(annotation)).replace("NoneType", "null")
    args = get_args(annotation)
    if origin is list:
        return f"{_type_name(args[0])}[]"
    if origin is dict:
        return "object"
    if str(origin) in ("typing.Literal",) or origin.__name__ == "Literal":
        return " | ".join(json.dumps(a) for a in args)
    if origin.__name__ in ("UnionType", "Union"):
        return " | ".join(_type_name(a) for a in args)
    if origin.__name__ == "Annotated":
        return _type_name(args[0])
    return str(annotation)


def _field_lines(model: type[BaseModel]) -> list[str]:
    lines = []
    for name, info in model.model_fields.items():
        if (model.__name__, name) in _SKIP_FIELDS:
            continue
        alias = info.alias or name
        required = info.is_required()
        lines.append(
            f"  - {alias} ({_type_name(info.annotation)}{', required' if required else ''}): {_describe(info)}"
        )
    return lines


def _describe(info: FieldInfo) -> str:
    desc = info.description or ""
    constraints = []
    for meta in info.metadata:
        for attr in ("ge", "le", "min_length", "max_length", "pattern"):
            if hasattr(meta, attr):
                constraints.append(f"{attr}={getattr(meta, attr)}")
    if constraints:
        desc += f" [{', '.join(constraints)}]"
    return desc.strip()


EXAMPLE: dict[str, Any] = {
    "schemaVersion": SCHEMA_VERSION,
    "id": "signals-and-systems",
    "title": "Signals & Systems",
    "subject": "Signals & Systems",
    "language": "en",
    "description": "LTI systems, Fourier analysis and sampling for a 3rd-semester medical engineering course.",
    "exam": {"date": "2027-02-05", "name": "Klausur"},
    "resources": [{"title": "Oppenheim & Willsky – Signals and Systems", "type": "book"}],
    "nodes": [
        {
            "id": "complex-numbers",
            "title": "Complex numbers & Euler's formula",
            "description": "Polar form and $e^{j\\theta} = \\cos\\theta + j\\sin\\theta$.",
            "objectives": ["Convert between $a + jb$ and $r e^{j\\theta}$"],
            "estimatedMinutes": 90,
            "difficulty": 1,
            "keywords": ["phasor", "Euler"],
            "flashcards": [
                {
                    "id": "euler",
                    "front": "Euler's formula?",
                    "back": "$e^{j\\theta} = \\cos\\theta + j\\sin\\theta$",
                }
            ],
        },
        {
            "id": "lti-systems",
            "title": "LTI systems & convolution",
            "description": "Impulse response and $y(t) = \\int x(\\tau)h(t-\\tau)\\,d\\tau$.",
            "objectives": [
                "Test linearity, time-invariance, causality",
                "Compute convolutions analytically",
            ],
            "estimatedMinutes": 240,
            "difficulty": 3,
            "prerequisites": ["complex-numbers"],
            "exercises": [
                {
                    "id": "rect-conv",
                    "title": "Convolution of two rectangles",
                    "statement": "Let $x(t)=\\mathrm{rect}(t)$ and $h(t)=\\mathrm{rect}(t/2)$.",
                    "parts": [
                        {
                            "label": "a",
                            "statement": "Sketch $x(\\tau)$ and $h(t-\\tau)$ for $t=0$.",
                        },
                        {
                            "label": "b",
                            "statement": "Compute $y = x*h$.",
                            "solution": "A trapezoid supported on $[-1.5, 1.5]$.",
                        },
                    ],
                    "difficulty": 2,
                }
            ],
        },
        {
            "id": "fourier-series",
            "title": "Fourier series",
            "parent": "frequency-domain",
            "description": "Periodic signals as $\\sum_k a_k e^{jk\\omega_0 t}$.",
            "estimatedMinutes": 180,
            "difficulty": 3,
            "prerequisites": [
                "complex-numbers",
                {
                    "id": "lti-systems",
                    "kind": "recommended",
                    "note": "Eigenfunction property motivates the topic",
                },
            ],
        },
        {
            "id": "frequency-domain",
            "title": "Frequency-domain analysis",
            "description": "Grouping node for all transform topics.",
            "estimatedMinutes": 0,
        },
    ],
}


def build_generation_prompt(
    topic: str = "<TOPIC>",
    context: str = "",
    language: str = "en",
    exam_date: str | None = None,
    node_count: str = "15-30",
) -> str:
    field_reference = "\n".join(
        [
            "Plan (top level):",
            *_field_lines(PlanSpec),
            "Node:",
            *_field_lines(NodeSpec),
            "Prerequisite object (alternative to a plain id string):",
            *_field_lines(Prerequisite),
            "Resource:",
            *_field_lines(Resource),
            "Flashcard:",
            *_field_lines(FlashcardSpec),
            "Exercise:",
            *_field_lines(ExerciseSpec),
            "ExercisePart:",
            *_field_lines(ExercisePartSpec),
        ]
    )
    exam_line = (
        f"- Exam date: {exam_date} (set `exam.date`)."
        if exam_date
        else "- No exam date is known; omit `exam`."
    )
    context_line = (
        f"- Course context: {context.strip()}"
        if context.strip()
        else "- Course context: Medical Engineering BSc (JKU Linz)."
    )
    return f"""You are an expert university tutor and curriculum designer. Create a structured learning plan as a single JSON document that follows the "LearningPlan" format (schemaVersion {SCHEMA_VERSION}) exactly.

Topic: {topic}
{context_line}
- Content language: {language}
{exam_line}
- Target size: {node_count} nodes, organised in 3-7 top-level groups with 2-6 topics each.

Requirements
1. Output ONLY the JSON document. No Markdown fences, no commentary before or after.
2. Every node needs a unique, stable `id` slug (lowercase letters, digits, hyphens, e.g. "fourier-series"). Reuse the same ids if asked to revise the plan later.
3. Use `parent` for hierarchy (chapter -> topics) and `prerequisites` for "learn X before Y" dependencies. Prerequisites must reference existing ids and must not form cycles. Mark soft dependencies with kind "recommended".
4. Write `description` and `objectives` in Markdown with LaTeX for math: `$...$` inline, `$$...$$` display. Escape backslashes properly for JSON (`\\\\frac`, `\\\\int`, ...).
5. Give realistic `estimatedMinutes` for every leaf topic (grouping nodes may use 0). Set `difficulty` from 1 (easy) to 5 (very hard).
6. Make objectives concrete and checkable ("Compute ... for ...", "Explain why ...", "Derive ...").
7. Add 2-4 `keywords` per node and, where a good source is known, `resources` with chapter/section notes.
8. Add 2-5 `flashcards` per leaf topic (short question -> precise answer) and 1-3 `exercises` with sub-parts and worked solutions where sensible.
9. Prefer depth and correctness over quantity. Do not invent URLs; omit `url` if unsure.

Field reference
{field_reference}

Minimal example (illustrates the shape; your plan must be far more complete):
{json.dumps(EXAMPLE, indent=2, ensure_ascii=False)}
"""
