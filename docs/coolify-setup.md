# Deploying the Learning Platform on Coolify — step-by-step guide

This guide is self-contained. It is written so that it can be handed to a person or an AI assistant
who has access to the Coolify UI (or Coolify's API/SSH) and to the GitHub repository, with no other
context.

## 0. What is being deployed

- **Repository:** `https://github.com/BlackDragdroit/learning-platform` (private), branch `main`.
- **Build:** a multi-stage `Dockerfile` in the repo root (Node builds the React frontend, Python 3.12
  runs FastAPI with uvicorn). Nothing else is needed — no separate database service.
- **Runtime:** one container, listens on port **8000**, serves both the API (`/api/*`) and the web
  app (`/`). Health check: `GET /api/health` → `{"status":"ok"}`.
- **Persistent data:** everything lives in **one directory inside the container: `/data`**
  (`/data/app.db` = SQLite database, `/data/uploads/` = PDFs, cropped figures, page previews).
  This directory **must** be a persistent volume, otherwise every redeploy wipes all data.
- **Database migrations run automatically at container start.** There is no manual migration step,
  neither on first deploy nor on updates.
- **Secrets:** only via environment variables. No file has to be edited in the repo.

## 1. Prerequisites

- A Coolify instance (v4) with a server attached and a domain pointing at it (A/AAAA record), e.g.
  `learn.example.com`. TLS is handled by Coolify/Traefik automatically.
- Coolify must be able to read the private GitHub repository: either a **GitHub App** connected in
  Coolify (*Sources → GitHub App*) or a **deploy key**. If none exists yet, create the GitHub App
  source first and install it on the repository.
- An **Anthropic API key** (`sk-ant-…`) from console.anthropic.com — required only for the AI
  features (PDF exercise extraction, flashcard generation, similar exercises). Everything else works
  without it.

## 2. Create the application

1. Coolify → **Projects** → choose/create a project (e.g. "Learning") → **+ New Resource**.
2. Pick **Private Repository (with GitHub App)** (or *Private Repository (with deploy key)*).
3. Repository: `BlackDragdroit/learning-platform`, branch: `main`.
4. **Build Pack: Dockerfile.** (Do **not** choose Nixpacks or Docker Compose.)
5. After creation, open the application's **General** tab and set:
   - **Dockerfile Location:** `/Dockerfile` (default)
   - **Base Directory:** `/` (default)
   - **Ports Exposes:** `8000`
   - **Domains:** `https://learn.example.com` (your domain; keep `https://`)
   - Leave *Ports Mappings* empty (Traefik routes to the exposed port).
6. Save.

## 3. Environment variables

Application → **Environment Variables**. Add these (mark the secrets as *secret*). The values must be
plain, without quotes.

| Variable | Value | Notes |
|---|---|---|
| `APP_PASSWORD` | a strong password | The single login password for the web app. |
| `SECRET_KEY` | ≥ 32 random characters | Generate with `python -c "import secrets;print(secrets.token_urlsafe(48))"` or `openssl rand -base64 48`. Never change it casually (it would not break data, but pick once and keep). |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Optional but needed for PDF import / generation. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model used for extraction/generation. Must support structured outputs (all current Claude models do). |
| `DATA_DIR` | `/data` | Keep exactly this; it must match the volume mount below. |
| `COOKIE_SECURE` | `true` | Keep `true` behind HTTPS (default). Only set `false` for plain-http testing. |
| `SESSION_TTL_DAYS` | `30` | Optional. |
| `MAX_UPLOAD_MB` | `50` | Optional. Max PDF size. |
| `EXTRACT_CHUNK_PAGES` | `8` | Optional. Pages per Claude request. |
| `LOG_LEVEL` | `info` | Optional. |

Do **not** set `STATIC_DIR` (the Dockerfile sets it). Do **not** tick "Build variable" for any of
these — they are runtime variables.

## 4. Persistent storage (critical)

Application → **Storages** → **+ Add**:

- Type: **Volume Mount**
- Name: anything, e.g. `learning-data`
- **Destination Path: `/data`**

Save. Without this mount the SQLite database and all uploads are lost on every redeploy.

(Alternatively a *bind mount* to a host directory such as `/opt/learning/data` → `/data` works too
and makes server-side backups with `rsync` easy. Either is fine; pick one and keep it.)

## 5. Health check (recommended)

Application → **Healthcheck**:

- Enable, Method `GET`, Scheme `http`, Host `localhost`, Port `8000`, Path `/api/health`,
  Return code `200`, Interval `30`, Timeout `5`, Retries `3`, Start period `30`.

The image also declares a Docker `HEALTHCHECK` on the same endpoint, so this is belt and braces.

## 6. Deploy

Click **Deploy**. The first build takes a few minutes (npm install + Python deps; the image is
~450 MB because of PyMuPDF). Follow the build log. Expected container log lines on a healthy start:

```
INFO  [alembic.runtime.migration] Running upgrade  -> c189442a7420, initial schema
INFO  [alembic.runtime.migration] Running upgrade c189442a7420 -> d0f0583c5b8a, documents and extraction jobs
INFO  [alembic.runtime.migration] Running upgrade d0f0583c5b8a -> 4f8c83940229, activity, study sessions, search index
INFO  [alembic.runtime.migration] Running upgrade 4f8c83940229 -> 04fa37225d81, fsrs flashcards and reviews
INFO:     Application startup complete.
```

Then open `https://learn.example.com`, log in with `APP_PASSWORD`.

**Smoke test after deploy**

1. `curl https://learn.example.com/api/health` → `{"status":"ok"}`.
2. Log in → *Subjects* → *Import plan* → paste the example plan from the repo
   (`docs/examples/signals-and-systems.json`) → the mind map appears.
3. Redeploy once (any no-op redeploy) and confirm the plan is still there → the volume works.
4. If `ANTHROPIC_API_KEY` is set: subject page → *Upload PDF* → *Extract exercises*; the job should
   progress and end in "Ready for review".

## 7. Updates

Every `git push` to `main` can redeploy automatically: Application → **General** → enable
**Auto Deploy** (webhook via the GitHub App). Otherwise click *Deploy* manually. Updates are
zero-config: new migrations run on startup, data stays in `/data`.

If a deploy ever leaves an extraction job stuck, the app marks it as failed on startup with the
message "Interrupted by a server restart. Start the extraction again." — that is expected.

## 8. Backups

Two independent options; use at least one:

- **In-app:** *Settings → Download backup* produces one ZIP (consistent SQLite snapshot + uploads).
  *Settings → Restore from backup* re-imports it (the previous database is kept on the volume as
  `app.db.bak-<timestamp>`).
- **Server-side:** back up the volume directory. With a Docker volume:
  `docker run --rm -v learning-data:/data -v $PWD:/out alpine tar czf /out/learning-$(date +%F).tgz -C /data .`
  (adjust the volume name; Coolify prefixes volume names with the application's UUID — find it with
  `docker volume ls`). For a consistent DB copy while the app runs, prefer
  `sqlite3 /data/app.db ".backup /data/snapshot.db"` or simply use the in-app backup.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Container restarts immediately, log shows `ValidationError … app_password … secret_key` | `APP_PASSWORD` / `SECRET_KEY` missing. Add them in Environment Variables (runtime, not build). |
| Login works locally but not on the domain, cookie not set | `COOKIE_SECURE=true` requires HTTPS. Make sure the domain in Coolify starts with `https://` and the certificate is issued. |
| `403 Missing X-Requested-With header` when calling the API with curl | Expected: state-changing requests need the header `X-Requested-With: fetch` (CSRF guard). The web app sends it automatically. |
| Data gone after redeploy | The `/data` volume mount is missing (section 4). |
| PDF extraction returns `400 ANTHROPIC_API_KEY is not configured` | Set the key and redeploy/restart. |
| Extraction fails with `invalid_request_error … tool_choice` or similar | Use a current model id in `ANTHROPIC_MODEL` (e.g. `claude-sonnet-5-5`). |
| Build fails at `npm ci` | Usually a transient network issue; retry the deploy. The lockfile is committed; no `package.json` edits are needed. |
| Image too large / slow build | Normal (~450 MB, PyMuPDF). Builds are cached after the first run. |
| Want to inspect the DB | `docker exec -it <container> python -c "import sqlite3;print(sqlite3.connect('/data/app.db').execute('select count(*) from plan_nodes').fetchone())"` |

## 10. Reference: what the container does at startup

1. Reads env vars (fails fast with a clear message if `APP_PASSWORD`/`SECRET_KEY` are missing).
2. Creates `/data` and `/data/uploads` if needed.
3. Runs `alembic upgrade head` (idempotent).
4. Creates the single owner user if missing, purges expired sessions, marks interrupted extraction
   jobs as failed, rebuilds the full-text search index.
5. Serves the API under `/api` and the SPA for every other path on port 8000.

The process runs as an unprivileged user (`app`) and is started with
`uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*'`, so
client IPs from Traefik are honoured for login rate limiting.
