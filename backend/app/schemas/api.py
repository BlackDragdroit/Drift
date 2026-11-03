from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.plan_format import PrerequisiteKind, Status

AttemptResult = Literal["solved", "partial", "failed"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ----------------------------------------------------------------------------- auth


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=512)


class UserOut(ORMModel):
    id: int
    username: str
    display_name: str


# ----------------------------------------------------------------------------- common


class IssueOut(BaseModel):
    path: str
    message: str
    severity: Literal["error", "warning"]


class ProgressSummary(BaseModel):
    nodes_total: int
    nodes_done: int
    nodes_in_progress: int
    minutes_total: int
    minutes_done: int
    ready_count: int
    percent: float


# ----------------------------------------------------------------------------- subjects


class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = Field("#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str = Field("book-open", max_length=32)
    description: str = ""


class SubjectUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str | None = Field(None, max_length=32)
    description: str | None = None
    archived: bool | None = None
    sort_order: int | None = None


class PlanSummaryOut(ORMModel):
    id: int
    subject_id: int
    key: str
    title: str
    description: str
    language: str | None
    exam_date: date | None
    exam_name: str | None
    tags: list[str]
    daily_capacity_minutes: int
    updated_at: datetime
    last_imported_at: datetime | None
    progress: ProgressSummary


class SubjectOut(ORMModel):
    id: int
    name: str
    slug: str
    color: str
    icon: str
    description: str
    sort_order: int
    archived: bool
    created_at: datetime
    plans: list[PlanSummaryOut] = []
    progress: ProgressSummary | None = None
    exercise_count: int = 0


# ----------------------------------------------------------------------------- plans


class PrerequisiteOut(BaseModel):
    node_id: int
    key: str
    kind: PrerequisiteKind
    note: str | None = None


class NodeProgressOut(BaseModel):
    status: Status
    started_at: datetime | None = None
    understood_at: datetime | None = None
    mastered_at: datetime | None = None
    updated_at: datetime | None = None


class NodeOut(ORMModel):
    id: int
    key: str
    parent_id: int | None
    title: str
    description: str
    objectives: list[str]
    estimated_minutes: int
    difficulty: int | None
    resources: list[dict[str, Any]]
    keywords: list[str]
    sort_order: int
    prerequisites: list[PrerequisiteOut]
    progress: NodeProgressOut
    ready: bool
    blocked_by: list[str]
    descendants_total: int
    descendants_done: int
    has_note: bool
    flashcard_count: int
    exercise_count: int


class PlanDetailOut(PlanSummaryOut):
    resources: list[dict[str, Any]]
    meta: dict[str, Any]
    schema_version: int
    created_at: datetime
    subject_name: str
    subject_color: str
    nodes: list[NodeOut]


class PlanUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    exam_date: date | None = None
    exam_name: str | None = None
    clear_exam: bool = False
    daily_capacity_minutes: int | None = Field(None, ge=15, le=16 * 60)


# ----------------------------------------------------------------------------- import


class ImportPreviewRequest(BaseModel):
    content: str = Field(min_length=1)
    format: Literal["auto", "json", "markdown"] = "auto"
    subject_id: int | None = None
    plan_id: int | None = None


class NodeDiffOut(BaseModel):
    key: str
    title: str
    change: Literal["added", "changed", "unchanged", "removed"]
    fields: list[str]
    has_progress: bool
    has_note: bool


class ImportPreviewOut(BaseModel):
    ok: bool
    detected_format: Literal["json", "markdown"] | None = None
    issues: list[IssueOut]
    mode: Literal["create", "merge"] | None = None
    plan_key: str | None = None
    plan_title: str | None = None
    subject_name: str | None = None
    existing_plan_id: int | None = None
    counts: dict[str, int] | None = None
    nodes: list[NodeDiffOut] = []
    exercises: int = 0
    flashcards: int = 0
    has_progress_block: bool = False
    has_notes_block: bool = False


class ImportRequest(ImportPreviewRequest):
    new_subject_name: str | None = Field(None, max_length=120)
    removed_nodes: Literal["archive", "delete"] = "archive"
    import_progress: bool = False
    import_notes: bool = False
    overwrite_existing_progress: bool = False


class ImportResultOut(BaseModel):
    plan_id: int
    subject_id: int
    issues: list[IssueOut]


# ----------------------------------------------------------------------------- nodes


class NodeUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    objectives: list[str] | None = None
    estimated_minutes: int | None = Field(None, ge=0)
    difficulty: int | None = Field(None, ge=1, le=5)
    resources: list[dict[str, Any]] | None = None
    keywords: list[str] | None = None


class ProgressUpdate(BaseModel):
    status: Status


class NoteUpdate(BaseModel):
    content: str


class NoteOut(BaseModel):
    content: str
    updated_at: datetime | None = None


class FlashcardOut(ORMModel):
    id: int
    front: str
    back: str


class ExercisePartOut(ORMModel):
    id: int
    label: str
    statement: str
    hints: list[str]
    solution: str | None


class ExerciseFigureOut(ORMModel):
    id: int
    part_id: int | None
    url: str
    caption: str
    page: int | None


class AttemptOut(ORMModel):
    id: int
    result: AttemptResult
    notes: str
    duration_seconds: int | None
    created_at: datetime


class ExerciseListItem(ORMModel):
    id: int
    subject_id: int
    number: str | None
    title: str
    difficulty: int | None
    source_label: str | None
    node_keys: list[str] = []
    last_result: AttemptResult | None = None
    attempt_count: int = 0


class ExerciseOut(ExerciseListItem):
    statement: str
    hints: list[str]
    solution: str | None
    tags: list[str]
    page_from: int | None
    page_to: int | None
    parts: list[ExercisePartOut]
    figures: list[ExerciseFigureOut]
    attempts: list[AttemptOut]
    node_ids: list[int] = []


class AttemptCreate(BaseModel):
    result: AttemptResult
    notes: str = ""
    duration_seconds: int | None = Field(None, ge=0)


class NodeDetailOut(NodeOut):
    plan_id: int
    plan_title: str
    note: NoteOut
    flashcards: list[FlashcardOut]
    exercises: list[ExerciseListItem]
    dependents: list[PrerequisiteOut]


class GenerationPromptOut(BaseModel):
    prompt: str
