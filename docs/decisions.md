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
