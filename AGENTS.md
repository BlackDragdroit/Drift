# Agent notes

Self-hosted learning platform: FastAPI + SQLite backend (`backend/`), React/Vite SPA (`frontend/`).
Read `docs/architecture.md`, `docs/plan-format.md` and `docs/decisions.md` before larger changes.

## Commands

```bash
# backend (uses uv; .env at repo root is picked up)
cd backend && uv sync
cd backend && uv run uvicorn app.main:app --reload --port 8000
cd backend && uv run pytest -q                 # must stay green
cd backend && uv run ruff check . && uv run ruff format .

# frontend
cd frontend && npm install
cd frontend && npm run dev                      # :5173, proxies /api -> :8000
cd frontend && npm run typecheck && npm test && npm run build
cd frontend && npm run lint                     # oxlint; warnings about setState-in-effect for dialog resets are accepted

# regenerate typed API client after changing backend schemas
cd backend && uv run python scripts/export_openapi.py && cd ../frontend && npm run gen:api

# migrations (run automatically at startup)
cd backend && uv run alembic revision --autogenerate -m "..."

# docker
docker build -t learning-platform:local . && docker compose up -d
```

## Conventions

- Business logic lives in `backend/app/services/*` as plain functions; routers stay thin.
- The plan format is defined once in `backend/app/schemas/plan_format.py`; validator, JSON Schema and the generation prompt derive from it. Update `docs/plan-format.md` when it changes.
- Content vs. progress separation: never let an import touch `node_progress`, `notes`, `attempts`.
- UI strings go in `frontend/src/i18n/en.ts` and are used via `t('key')`.
- State-changing API calls need the `X-Requested-With: fetch` header (CSRF guard); the client adds it.
- Log notable decisions in `docs/decisions.md`.
- On Windows, `uvicorn --reload` sometimes hangs after "Reloading..."; restart it manually.
