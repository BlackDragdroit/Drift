# Decisions

Short log of choices made where the brief left room. Newest at the bottom.

## 2026-11-03 — Phase 0/1

**Stack: FastAPI + SQLite + React/Vite SPA in one container.**
Python holds the business logic (plan validation, merge, graph maths, later the PDF pipeline with
PyMuPDF) because that is where the owner is strongest and where the hard parts are best served.
The SPA is built in a Node stage and served as static files by FastAPI; one image, one volume.

**Plan format: flat node list with `parent` + `prerequisites`.**
Flat lists are easier for LLMs to produce correctly and easier to diff/merge by id. Nested
`children` is accepted as input and flattened. Prerequisites carry a `kind` (`required` /
`recommended`) so advisory links don't block "ready to learn".

**Single source of truth for the format.** Pydantic models generate the JSON Schema and the field
reference inside the generation prompt. Adding a field to the model updates both automatically.

**Progress is separate from content.** `node_progress`, `notes`, `attempts` live in their own
tables keyed by node id, which is what makes re-import a pure content update.

**Removed nodes are archived, not deleted, by default.** Deleting is an explicit choice in the
import preview. Archived nodes keep their progress and come back if the id reappears.

**"Ready to learn"** = status `not_started`, all *required* prerequisites done (`understood` or
`mastered`), and the node is a leaf. Grouping nodes (with children) are never "ready" themselves;
they aggregate their children's progress instead.

**Progress percentage is minute-weighted.** `percent = done minutes / total minutes`, where nodes
without an estimate count 30 min and grouping nodes with children count 0. Falls back to node
counts when a plan has no estimates at all. Node counts are shown alongside.

**Embedded exercises and flashcards in plans.** A plan may ship exercises/flashcards per node. They
are merged by `id` (or position). Exercises with logged attempts survive removal from the file.

**Auth: single password, server-side sessions.** Password from `APP_PASSWORD`, compared in
constant time; opaque session tokens (hash stored in SQLite, 30-day sliding expiry) in an
HttpOnly/Secure/SameSite=Lax cookie; 5 failed logins per minute per IP; state-changing API calls
require an `X-Requested-With: fetch` header as a CSRF belt-and-braces. A `users` table exists from
day one so sharing with friends later is an additive change.

**Migrations run on startup** (`alembic upgrade head` in the FastAPI lifespan). No separate
migration step in deployment.

**Mind map layout: compound layered graph (ELK).** Chapters (nodes with children) are rendered as
containers with their topics inside; prerequisite edges flow across containers. Hierarchy edges are
therefore not drawn as lines. Collapsing a container turns it into a single card and re-routes edges
of hidden descendants to it. ELK's `considerModelOrder` options crash on compound graphs and are
not used. Default direction: left→right on desktop, top→bottom on phones (persisted per device).

**ELK is lazy-loaded.** The bundled ELK is ~1.4 MB; the map chunk is only fetched when a plan page
opens.

**Outline view is the default on phones**, the map on desktop. The node panel is a right-side sheet
on desktop and a bottom sheet on phones. The selected node lives in the URL (`?node=ID`) so links
and the back button work.

**UI strings are centralised** (`frontend/src/i18n/en.ts`) with a typed `t()` helper; English for
now, German can be added as a second file.

**Dev-only dependency audit finding** (`minimatch` via `openapi-typescript` → `@redocly/openapi-core`)
is accepted: it is a code-generation tool that never ships to the browser or the server.

## 2026-11-03 — Phase 2 (PDF exercise import)

**Structured output via forced tool use.** Each chunk request forces the `record_exercises` tool
whose `input_schema` is generated from the pydantic `ChunkOut` model (refs inlined). Output is
validated with pydantic; on failure the request is retried once with the validation errors appended.
A second failure fails the job with a readable error.

**Chunking without overlap, stitching with flags.** Pages are sent in chunks of
`EXTRACT_CHUNK_PAGES` (default 8; a 1-page remainder is folded into the previous chunk). Instead of
overlapping pages (which produces duplicates), the model marks `continues_on_next` /
`continues_from_previous`; adjacent flagged exercises with compatible numbers are merged.

**Text PDFs go as PDF, scanned PDFs as JPEG pages.** `inspect_pdf` samples up to six pages; if fewer
than half have a text layer the document is treated as scanned and each page is rendered at ~100 dpi
JPEG. The sub-PDF path keeps the model's text extraction exact; the image path is the fallback.

**Figures are cropped server-side at 200 dpi** from the model's normalised bounding boxes (ordered,
clamped, +1% margin). Bad boxes are reported as notes, never fatal. The review screen lets you draw
a replacement rectangle; the crop goes through the same endpoint.

**Jobs run in-process, one at a time.** An `asyncio` task per job, guarded by a semaphore, progress
written to SQLite after every chunk, cancellation checked between chunks. Jobs that were running
when the process died are marked failed on startup ("start again"). Good enough for one user; a
queue service would be the upgrade path.

**Draft lives on the job.** The review screen autosaves the edited drafts to `extraction_jobs.draft`
(debounced), so a reload or a phone/desktop switch never loses work. Commit turns drafts into
`exercises` rows, links figures to parts by label, filters topic ids to the subject, skips empty
drafts, and clears the draft.

**Uploads are content-addressed per subject** (`uploads/documents/s{subject}-{sha16}.pdf`); the
original filename lives in the database. Re-uploading the same file returns the existing document.
Page previews are cached as PNG under `uploads/pages/`.

**Cost estimate uses a static price table** (prefix-matched on the model id); unknown models show
tokens only.

**PyMuPDF pinned to 1.x.** 2.x pulls in onnxruntime/numpy for layout analysis that this project does
not use (would add ~250 MB to the image).

**Structured outputs instead of forced tool use.** Current models reject `tool_choice: tool/any`
(adaptive thinking). `output_config.format` with a JSON schema gives constrained decoding; the
schema is sanitised to the documented limits (no numeric/string constraints, every property
required with nullable optionals, `additionalProperties: false`).

## 2026-11-03 — Phase 3 (learning loop)

**The schedule is stateless.** `build_schedule` recomputes on every request from the plan, the exam
date and the daily capacity: remaining units (leaf topics or parents with their own estimate) in
prerequisite order, in-progress first, packed day by day at `max(needed, 15)` minutes where
`needed = ceil(remaining / study_days)`; the last day before the exam is a review buffer when there
are more than three days left. Falling behind therefore re-spreads automatically; `behind` is raised
when the needed pace exceeds the capacity instead of silently overflowing past the exam. Without an
exam date the plan is paced by capacity and shows the projected finish date.

**Activity log drives streaks.** Every learning action (status change, attempt, note, study session
≥ 1 min, import, saved exercises) writes an `activity_events` row; streaks are computed per local
day using the browser's timezone offset. A streak counts back from today or yesterday, so an
evening session does not break it before you studied today.

**Weak spots are attempt-based.** Topics ranked by `(failed + 0.5·partial) / attempts` over the last
45 days (topics with no failures are excluded). "Retry these" lists exercises whose *latest* attempt
was failed/partial.

**Exam mix** samples without replacement, weighting failed (3×), partial (2×), untried (1.5×) and
solved (0.6×) exercises, then orders easy → hard. Random/sequential modes are deterministic with a
seed (used in tests).

**One study session at a time.** Starting a session stops any running one; a forgotten timer is
capped at 4 hours on stop. Actual minutes per topic are shown next to the estimate in the node panel.

**Search is SQLite FTS5**, maintained incrementally on writes and fully rebuilt at startup (so older
databases get indexed). LaTeX control sequences are stripped before indexing so "fourier" matches
inside math. Queries are tokenised into quoted prefix terms, so partial words match.

**Command palette (cmdk)** combines navigation, actions and search; `Ctrl/Cmd+K` or `/` open it,
`?` shows the shortcut sheet, `g h / g s / g p` navigate, `m / o / s` switch plan views, and in
practice `h / s / 1 2 3 / n` drive the session.
