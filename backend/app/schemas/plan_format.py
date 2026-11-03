"""Learning plan import/export format, version 1.

This module is the single source of truth: validation, the published JSON Schema
(`GET /api/plans/schema.json`) and the LLM generation prompt are all derived from it.
See docs/plan-format.md for the human-readable specification.
"""

import datetime as dt
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.core.text import SLUG_PATTERN, parse_minutes

SCHEMA_VERSION = 1
SUPPORTED_SCHEMA_VERSIONS = (1,)

Status = Literal["not_started", "in_progress", "understood", "mastered"]
PrerequisiteKind = Literal["required", "recommended"]
ResourceType = Literal["book", "video", "paper", "website", "course", "lecture", "other"]


class FormatModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="ignore", str_strip_whitespace=True
    )


def _coerce_minutes(value: Any) -> Any:
    parsed = parse_minutes(value)
    return parsed if parsed is not None else value


Minutes = Annotated[int, BeforeValidator(_coerce_minutes), Field(ge=0)]
Slug = Annotated[str, Field(pattern=SLUG_PATTERN, max_length=120)]


class Resource(FormatModel):
    title: str = Field(
        min_length=1, max_length=300, description="Human-readable name of the resource."
    )
    url: str | None = Field(None, description="Optional link.")
    type: ResourceType = Field(
        "other", description="One of: book, video, paper, website, course, lecture, other."
    )
    note: str | None = Field(
        None, description="Where exactly to look, e.g. 'Chapter 3.2, pp. 120-134'."
    )


class Prerequisite(FormatModel):
    id: str = Field(description="ID of the node that should be learned first.")
    kind: PrerequisiteKind = Field(
        "required",
        description="'required' blocks the node until done; 'recommended' is advisory only.",
    )
    note: str | None = Field(None, description="Why this prerequisite matters.")


class FlashcardSpec(FormatModel):
    id: str | None = Field(
        None, description="Stable ID so re-imports update instead of duplicating."
    )
    front: str = Field(min_length=1, description="Question / prompt side (Markdown + LaTeX).")
    back: str = Field(min_length=1, description="Answer side (Markdown + LaTeX).")


class ExercisePartSpec(FormatModel):
    label: str = Field(
        min_length=1, max_length=16, description="Sub-part label such as 'a', 'b', 'ii'."
    )
    statement: str = Field(min_length=1, description="Task text (Markdown + LaTeX).")
    hints: list[str] = Field(
        default_factory=list, description="Progressive hints, revealed one at a time."
    )
    solution: str | None = Field(None, description="Worked solution (Markdown + LaTeX).")


class ExerciseSpec(FormatModel):
    id: str | None = Field(
        None, description="Stable ID (unique within the node) used as merge key."
    )
    number: str | None = Field(
        None, description="Exercise number as printed in the source, e.g. '3.4'."
    )
    title: str | None = Field(None, description="Short title.")
    statement: str = Field(
        "", description="Main task text; may be empty when all content is in parts."
    )
    parts: list[ExercisePartSpec] = Field(default_factory=list)
    hints: list[str] = Field(default_factory=list, description="Hints for the whole exercise.")
    solution: str | None = Field(None, description="Solution for the whole exercise.")
    difficulty: int | None = Field(None, ge=1, le=5, description="1 = routine, 5 = exam-killer.")


class NodeSpec(FormatModel):
    id: Slug = Field(
        description="Unique slug (lowercase, digits, hyphens). Stable across re-imports; used to merge."
    )
    title: str = Field(min_length=1, max_length=200, description="Short topic title.")
    parent: str | None = Field(
        None, description="ID of the parent node for hierarchical grouping. Omit for top level."
    )
    description: str = Field(
        "",
        description="What this topic is about, Markdown + LaTeX ($...$ inline, $$...$$ display).",
    )
    objectives: list[str] = Field(
        default_factory=list, description="Concrete, checkable learning objectives."
    )
    estimated_minutes: Minutes = Field(
        0, description="Realistic study time in minutes (0 for pure grouping nodes)."
    )
    difficulty: int | None = Field(None, ge=1, le=5, description="1 = easy, 5 = very hard.")
    prerequisites: list[str | Prerequisite] = Field(
        default_factory=list,
        description="Node IDs that must be learned before this one. A plain string means kind='required'.",
    )
    resources: list[Resource] = Field(default_factory=list)
    keywords: list[str] = Field(
        default_factory=list, description="Search terms and synonyms; also used to match exercises."
    )
    flashcards: list[FlashcardSpec] = Field(
        default_factory=list, description="Optional flashcards for spaced repetition."
    )
    exercises: list[ExerciseSpec] = Field(
        default_factory=list, description="Optional practice exercises for this node."
    )
    children: list["NodeSpec"] = Field(
        default_factory=list,
        description="Alternative to 'parent': nested child nodes. Flattened on import.",
    )

    @field_validator("prerequisites", mode="after")
    @classmethod
    def _normalize_prerequisites(cls, value: list[str | Prerequisite]) -> list[Prerequisite]:
        return [Prerequisite(id=v) if isinstance(v, str) else v for v in value]

    @field_validator("objectives", "keywords", mode="after")
    @classmethod
    def _drop_empty_strings(cls, value: list[str]) -> list[str]:
        return [v for v in value if v]


class Exam(FormatModel):
    date: dt.date = Field(description="ISO date (YYYY-MM-DD) of the exam.")
    name: str | None = Field(None, description="e.g. 'Klausur', 'Final exam'.")


class ProgressEntry(FormatModel):
    status: Status
    updated_at: dt.datetime | None = None


class PlanSpec(FormatModel):
    schema_version: Literal[1] = Field(description="Format version. Currently 1.")
    id: Slug | None = Field(
        None, description="Stable plan slug. Re-importing a plan with the same id merges."
    )
    title: str = Field(min_length=1, max_length=200)
    subject: str | None = Field(
        None, description="Subject name, e.g. 'Signals & Systems'. Used as default on import."
    )
    language: str | None = Field(
        None, max_length=8, description="BCP-47 code of the content language, e.g. 'en', 'de'."
    )
    description: str = Field("", description="Plan overview, Markdown + LaTeX.")
    exam: Exam | None = None
    tags: list[str] = Field(default_factory=list)
    resources: list[Resource] = Field(
        default_factory=list, description="Plan-wide resources (textbooks, course pages)."
    )
    meta: dict[str, Any] = Field(
        default_factory=dict,
        description="Free-form provenance: author, generatedBy, createdAt, ...",
    )
    nodes: list[NodeSpec] = Field(
        min_length=1, description="Flat list of topic nodes (hierarchy via 'parent')."
    )
    progress: dict[str, ProgressEntry] | None = Field(
        None,
        description="Export-only: learner progress keyed by node id. Ignored unless explicitly imported.",
    )
    notes: dict[str, str] | None = Field(
        None, description="Export-only: personal notes keyed by node id."
    )


NodeSpec.model_rebuild()


def plan_json_schema() -> dict[str, Any]:
    schema = PlanSpec.model_json_schema(by_alias=True)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["title"] = "LearningPlan"
    return schema
