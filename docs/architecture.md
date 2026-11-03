# Architecture

```
┌──────────────────────────────── Docker image ────────────────────────────────┐
│  FastAPI (uvicorn :8000)                                                     │
│   ├─ /api/*            JSON API (auth, subjects, plans, nodes, exercises…)  │
│   ├─ /api/health       health check used by Docker/Coolify                  │
│   ├─ /api/docs         OpenAPI UI                                           │
│   └─ /*                React SPA (static files from the Node build stage)   │
│                                                                              │
│  /data (volume)   app.db (SQLite, WAL)   uploads/ (PDFs, cropped figures)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Backend (`backend/`)

| Path | Purpose |
|---|---|
| `app/main.py` | App factory, CSRF header guard, health endpoint, SPA fallback, startup migrations |
| `app/core/config.py` | Settings from env (`pydantic-settings`), `.env` for local dev |
| `app/core/db.py` | SQLAlchemy engine/session, SQLite pragmas (WAL, FK), Alembic runner |
| `app/core/security.py` | Password check, session tokens, login rate limiter |
| `app/models/` | SQLAlchemy models: users/sessions, subjects, plans/nodes/prerequisites/progress/notes/flashcards, exercises/parts/figures/attempts |
| `app/schemas/plan_format.py` | **The plan format** (pydantic) → validator, JSON Schema, prompt |
| `app/schemas/api.py` | Request/response models for the API |
| `app/services/plan_validation.py` | normalize → pydantic → semantic checks → `Issue[]` |
| `app/services/plan_markdown.py` | Markdown outline → raw plan dict |
| `app/services/plan_import.py` | parse, preview diff, apply (create/merge), `set_status` |
| `app/services/plan_export.py` | DB → plan JSON (optionally with progress/notes) |
| `app/services/plan_prompt.py` | Generation prompt built from the pydantic models |
| `app/services/graph.py` | Ready-to-learn, blocking prerequisites, aggregated progress, topological order |
| `app/services/pdf.py` | PyMuPDF: inspect (page count, text layer), render pages, crop figures, sub-PDFs, content-addressed upload storage |
| `app/services/extraction.py` | Claude extraction: output schema (`ChunkOut`), system/user prompts, forced tool call, validation retry, chunk planning, stitching, draft building, cost table |
| `app/services/jobs.py` | In-process job runner (`JobRunner`), `run_extraction`, startup recovery |
| `app/services/schedule.py` | Stateless scheduler: remaining topics in prerequisite order spread over the days until the exam, capacity-aware |
| `app/services/activity.py` | Activity log, streaks, weak spots, study sessions |
| `app/services/practice.py` | Practice queue (filters, random / sequential / exam mix) |
| `app/services/search.py` | FTS5 index maintenance + search |
| `app/services/flashcards.py` | FSRS scheduling (py-fsrs), due queue, interval previews |
| `app/services/generation.py` | Claude structured-output helpers: flashcards from a topic, exercise variations |
| `app/services/backup.py` | ZIP backup (SQLite snapshot + uploads) and restore |
| `app/api/` | Routers: `auth`, `dashboard`, `subjects`, `plans` (incl. `/schedule`), `nodes`, `exercises`, `documents`, `jobs`, `files`, `practice`, `sessions`, `search`, `flashcards`, `system` (backup/restore/reindex/similar); `serializers.py` maps models → API |
| `alembic/` | Migrations (run automatically on startup) |
| `tests/` | pytest: validation, merge, markdown, graph, API workflow |
| `scripts/export_openapi.py` | Dumps `openapi.json` for the frontend type generator |

Business rules live in `services/` as plain functions over ORM objects, so they are unit-testable
without HTTP.

## Frontend (`frontend/`)

| Path | Purpose |
|---|---|
| `src/api/` | `client.ts` (openapi-fetch + CSRF header + 401 broadcast), `schema.d.ts` (generated), `hooks.ts` (TanStack Query hooks with optimistic status updates) |
| `src/i18n/` | All UI strings + typed `t()` |
| `src/components/ui/` | Button, inputs, Dialog/Sheet, dropdown, tooltip, progress, badges |
| `src/components/` | `Markdown` (react-markdown + KaTeX), `StatusControl`, layout shell |
| `src/routes/` | Login, Dashboard, Subjects, Subject, Plan |
| `src/features/plans/` | `graph.ts` (visibility/collapse/focus, pure), `layout.ts` (ELK compound layout), `MindMap`, `PlanNodeCard`, `PlanGroupNode`, `OutlineView`, `NodePanel`, `ImportDialog`, `GenerationPromptDialog`, edit dialogs |
| `src/features/exercises/` | Exercise row + dialog (hints → solution reveal, attempt logging, edit/delete, source page) |
| `src/features/documents/` | PDF upload section, job cards, review page parts (page viewer with crop tool, draft editor, topic picker, pure `draftOps`) |
| `src/routes/PracticePage.tsx` | Practice setup → timed session with keyboard shortcuts → summary |
| `src/features/plans/ScheduleView.tsx` | Schedule tab (pacing meters, day groups) |
| `src/components/CommandPalette.tsx`, `StudyTimer.tsx` | Ctrl+K palette with live search + actions, shortcut sheet, floating study-timer pill |
| `src/api/learning.ts` | Hooks for schedule, dashboard v2, practice queue, search, study sessions |
| `src/features/subjects/` | Subject dialog + icon set |

Type safety across the wire: `python scripts/export_openapi.py && npm run gen:api` regenerates
`schema.d.ts`; the hooks are typed against it.

## Request flow for an import

1. User pastes JSON/Markdown → `POST /api/plans/import/preview` (debounced).
2. `parse_content` detects the format → `validate_plan` → issues + `PlanSpec`.
3. `preview_import` diffs the spec against the existing plan (by plan id within the subject) → counts, per-node changes.
4. UI shows issues/diff/options → `POST /api/plans/import` → `apply_import` in one transaction.
5. Query cache invalidated → navigate to the plan.

## Pipeline for a PDF import

1. `POST /api/documents` (multipart) → stored content-addressed under `uploads/documents/`, inspected
   with PyMuPDF (page count, text layer, sha256). Same content → same document.
2. `POST /api/documents/{id}/extract` → `extraction_jobs` row (`pending`) → `JobRunner.start`.
3. `run_extraction`: page range split into chunks → per chunk a sub-PDF (or JPEG pages for scans) +
   topic list of the subject/plan → Claude with the forced `record_exercises` tool → pydantic
   validation (one retry with feedback) → progress + tokens written after each chunk.
4. `stitch` merges exercises crossing chunk boundaries; `build_drafts` crops every figure to PNG
   under `uploads/figures/` → job status `review`, drafts stored on the job.
5. Review screen (`/jobs/{id}/review`): page images from `/api/documents/{id}/pages/{n}`, drafts
   edited client-side and autosaved via `PUT /api/jobs/{id}/draft`; drawing a rectangle calls
   `POST /api/jobs/{id}/figures`.
6. `POST /api/jobs/{id}/commit` → `exercises`, `exercise_parts`, `exercise_figures`,
   `exercise_node_links`; job `done`.

## Data flow for the map

`GET /api/plans/{id}` returns nodes with computed `ready`, `blocked_by`, descendant progress and
counts. The frontend only decides *visibility* (collapse, hide finished, focus) and *layout*
(ELK, run in the browser, re-run only when the visible structure changes). Status changes are
optimistic and then refetched so readiness of neighbours updates.
