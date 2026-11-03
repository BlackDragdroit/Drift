import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.router import api_router
from app.core.config import get_settings
from app.core.db import get_engine, get_sessionmaker, run_migrations
from app.core.security import ensure_owner_user, purge_expired_sessions

log = logging.getLogger("app")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())
    run_migrations()
    with get_sessionmaker()() as db:
        ensure_owner_user(db)
        purge_expired_sessions(db)
    log.info("Data directory: %s", settings.data_dir.resolve())
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Learning Platform",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next):
        # Cookie auth + SameSite=Lax already blocks cross-site POSTs from top-level navigations;
        # requiring a custom header closes the remaining form-post vector.
        if (
            request.url.path.startswith("/api/")
            and request.method not in SAFE_METHODS
            and request.headers.get("x-requested-with") != "fetch"
        ):
            return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)
        return await call_next(request)

    @app.get("/api/health", tags=["health"])
    def health() -> dict[str, str]:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok"}

    app.include_router(api_router)

    static_dir = settings.static_dir or Path(__file__).resolve().parents[1] / "static"
    if static_dir.is_dir():
        assets = static_dir / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            candidate = (static_dir / full_path).resolve()
            if full_path and candidate.is_file() and static_dir.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(static_dir / "index.html")

    return app


app = create_app()
