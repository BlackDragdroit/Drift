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
    answer: str = ""
    duration_seconds: int | None
    created_at: datetime


class ExerciseNodeRef(BaseModel):
    id: int
    title: str
    plan_id: int


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
    document_id: int | None = None
    document_title: str | None = None
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
    nodes: list[ExerciseNodeRef] = []


class AttemptCreate(BaseModel):
    result: AttemptResult
    notes: str = ""
    answer: str = ""
    duration_seconds: int | None = Field(None, ge=0)


class NodeDetailOut(NodeOut):
    actual_minutes: int = 0
    plan_id: int
    plan_title: str
    note: NoteOut
    flashcards: list[FlashcardOut]
    exercises: list[ExerciseListItem]
    dependents: list[PrerequisiteOut]


class GenerationPromptOut(BaseModel):
    prompt: str


class SubjectNodeOut(BaseModel):
    id: int
    key: str
    title: str
    plan_id: int
    plan_title: str


# ----------------------------------------------------------------------------- exercise editing


class ExercisePartIn(BaseModel):
    label: str = Field(min_length=1, max_length=16)
    statement: str = ""
    hints: list[str] = []
    solution: str | None = None


class ExerciseUpdate(BaseModel):
    number: str | None = Field(None, max_length=32)
    title: str | None = Field(None, max_length=200)
    statement: str | None = None
    hints: list[str] | None = None
    solution: str | None = None
    clear_solution: bool = False
    difficulty: int | None = Field(None, ge=1, le=5)
    clear_difficulty: bool = False
    tags: list[str] | None = None
    parts: list[ExercisePartIn] | None = None
    node_ids: list[int] | None = None


class ExerciseCreate(BaseModel):
    subject_id: int
    number: str | None = Field(None, max_length=32)
    title: str = Field(min_length=1, max_length=200)
    statement: str = ""
    hints: list[str] = []
    solution: str | None = None
    difficulty: int | None = Field(None, ge=1, le=5)
    tags: list[str] = []
    parts: list[ExercisePartIn] = []
    node_ids: list[int] = []


# ----------------------------------------------------------------------------- documents & extraction


class JobOut(ORMModel):
    id: int
    document_id: int
    plan_id: int | None
    status: Literal["pending", "running", "review", "done", "failed", "cancelled"]
    model: str
    page_from: int
    page_to: int
    chunks_total: int
    chunks_done: int
    current_pages: str | None
    used_images: bool
    error: str | None
    notes: list[str]
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float | None = None
    created_exercise_ids: list[int]
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class DocumentOut(ORMModel):
    id: int
    subject_id: int
    filename: str
    title: str
    page_count: int
    size_bytes: int
    has_text_layer: bool
    created_at: datetime
    exercise_count: int = 0
    latest_job: JobOut | None = None


class StartExtractionRequest(BaseModel):
    plan_id: int | None = None
    page_from: int | None = Field(None, ge=1)
    page_to: int | None = Field(None, ge=1)


class FigureDraft(BaseModel):
    id: str
    page: int
    bbox: list[float] = Field(min_length=4, max_length=4)
    caption: str = ""
    part_label: str | None = None
    path: str
    url: str | None = None


class PartDraft(BaseModel):
    id: str
    label: str = Field(min_length=1, max_length=16)
    statement: str = ""
    hints: list[str] = []
    solution: str | None = None


class ExerciseDraft(BaseModel):
    id: str
    number: str | None = None
    title: str = ""
    statement: str = ""
    parts: list[PartDraft] = []
    hints: list[str] = []
    solution: str | None = None
    difficulty: int | None = Field(None, ge=1, le=5)
    page_from: int
    page_to: int
    figures: list[FigureDraft] = []
    node_ids: list[int] = []
    suggested_node_ids: list[int] = []


class JobDetailOut(JobOut):
    draft: list[ExerciseDraft] | None = None
    document: DocumentOut


class DraftUpdate(BaseModel):
    exercises: list[ExerciseDraft]


class CropRequest(BaseModel):
    page: int = Field(ge=1)
    bbox: list[float] = Field(min_length=4, max_length=4)
    caption: str = ""


class CommitRequest(BaseModel):
    exercises: list[ExerciseDraft]


class CommitOut(BaseModel):
    exercise_ids: list[int]
    skipped: int


# ----------------------------------------------------------------------------- schedule


class ScheduledNodeOut(BaseModel):
    node_id: int
    key: str
    title: str
    minutes: int
    status: Status
    ready: bool
    part: int | None = None
    parts: int | None = None


class ScheduleDayOut(BaseModel):
    date: date
    minutes: int
    nodes: list[ScheduledNodeOut]


class ScheduleSummaryOut(BaseModel):
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


class ScheduleOut(BaseModel):
    summary: ScheduleSummaryOut
    days: list[ScheduleDayOut]


# ----------------------------------------------------------------------------- practice


class PracticeRequest(BaseModel):
    subject_id: int | None = None
    plan_id: int | None = None
    node_ids: list[int] | None = None
    difficulty_min: int | None = Field(None, ge=1, le=5)
    difficulty_max: int | None = Field(None, ge=1, le=5)
    unsolved_only: bool = False
    limit: int = Field(10, ge=1, le=100)
    mode: Literal["sequential", "random", "exam"] = "random"
    seed: int | None = None


class PracticeQueueOut(BaseModel):
    exercise_ids: list[int]
    total_available: int


# ----------------------------------------------------------------------------- sessions


class SessionStart(BaseModel):
    subject_id: int | None = None
    node_id: int | None = None


class SessionStop(BaseModel):
    note: str = ""


class SessionOut(ORMModel):
    id: int
    subject_id: int | None
    node_id: int | None
    node_title: str | None = None
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: int | None
    note: str


# ----------------------------------------------------------------------------- search


class SearchHitOut(BaseModel):
    kind: Literal["subject", "plan", "node", "note", "exercise"]
    id: int
    title: str
    snippet: str
    subject_id: int
    subject_name: str
    subject_color: str
    plan_id: int | None = None
    node_id: int | None = None
    url: str


# ----------------------------------------------------------------------------- dashboard v2


class DashboardNodeOut(BaseModel):
    node_id: int
    key: str
    title: str
    estimated_minutes: int
    difficulty: int | None
    status: Status
    plan_id: int
    plan_title: str
    subject_id: int
    subject_name: str
    subject_color: str


class DashboardExamOut(BaseModel):
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
    needed_per_day: int
    capacity_minutes: int
    behind: bool


class StreakOut(BaseModel):
    current: int
    longest: int
    active_today: bool
    minutes_today: int
    days: list[date]


class WeakSpotOut(BaseModel):
    node_id: int
    key: str
    title: str
    plan_id: int
    plan_title: str
    subject_id: int
    subject_name: str
    subject_color: str
    attempts: int
    failed: int
    partial: int
    score: float


class RetryExerciseOut(BaseModel):
    id: int
    title: str
    number: str | None
    subject_id: int
    subject_name: str
    subject_color: str
    last_result: AttemptResult
    node_keys: list[str]


# ----------------------------------------------------------------------------- flashcards


class FlashcardDetailOut(ORMModel):
    id: int
    node_id: int
    front: str
    back: str
    due: datetime | None
    reps: int
    lapses: int
    last_review: datetime | None
    source: str
    retrievability: float | None = None
    node_title: str | None = None
    plan_id: int | None = None
    subject_id: int | None = None
    subject_color: str | None = None
    intervals: dict[str, str] | None = None


class FlashcardCreate(BaseModel):
    node_id: int
    front: str = Field(min_length=1)
    back: str = Field(min_length=1)


class FlashcardUpdate(BaseModel):
    front: str | None = Field(None, min_length=1)
    back: str | None = Field(None, min_length=1)


class FlashcardReviewIn(BaseModel):
    rating: int = Field(ge=1, le=4)
    duration_ms: int | None = Field(None, ge=0)


class DueQueueOut(BaseModel):
    cards: list[FlashcardDetailOut]
    due: int
    new: int
    total: int


class GenerateCardsRequest(BaseModel):
    count: int = Field(5, ge=1, le=20)


class GeneratedOut(BaseModel):
    created: int
    input_tokens: int
    output_tokens: int


class BackupInfoOut(BaseModel):
    db_bytes: int
    uploads_bytes: int
    previous_backups: list[str]


class RestoreOut(BaseModel):
    created_at: str | None
    upload_files: int
    db_bytes: int
    previous_kept_as: str


class DashboardOut(BaseModel):
    flashcards_due: int = 0
    flashcards_new: int = 0
    subjects_count: int
    plans_count: int
    nodes_total: int
    nodes_done: int
    exercises_total: int
    exams: list[DashboardExamOut]
    due_today: list[DashboardNodeOut]
    ready: list[DashboardNodeOut]
    in_progress: list[DashboardNodeOut]
    streak: StreakOut
    weak_spots: list[WeakSpotOut]
    retry_exercises: list[RetryExerciseOut]
    active_session: SessionOut | None = None


# --- Formula sheet -------------------------------------------------------------------------------

FormulaSource = Literal["manual", "exercise", "generated"]


class FormulaOut(ORMModel):
    id: int
    plan_id: int
    node_id: int | None
    node_title: str | None = None
    exercise_id: int | None
    title: str
    content: str
    note: str
    source: FormulaSource
    sort_order: int
    updated_at: datetime


class FormulaCreate(BaseModel):
    """Either `plan_id` or `node_id` (the plan is derived from the node)."""

    plan_id: int | None = None
    node_id: int | None = None
    exercise_id: int | None = None
    title: str = Field("", max_length=200)
    content: str = Field(min_length=1)
    note: str = ""
    source: FormulaSource = "manual"


class FormulaUpdate(BaseModel):
    node_id: int | None = None
    title: str | None = Field(None, max_length=200)
    content: str | None = Field(None, min_length=1)
    note: str | None = None


class FormulaReorder(BaseModel):
    ids: list[int]


class FormulaHarvestRequest(BaseModel):
    """Exactly one of `exercise_id` / `node_id`: the material the formulas are extracted from."""

    exercise_id: int | None = None
    node_id: int | None = None


class FormulaCandidateOut(BaseModel):
    title: str
    content: str
    note: str


class FormulaHarvestOut(BaseModel):
    plan_id: int
    node_id: int | None
    exercise_id: int | None
    candidates: list[FormulaCandidateOut]
    input_tokens: int
    output_tokens: int
