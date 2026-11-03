"""Full backup (SQLite snapshot + uploads) as one ZIP, and restore from such a ZIP."""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from app.core import db as dbm
from app.core.config import get_settings

MANIFEST = "manifest.json"
BACKUP_VERSION = 1


def create_backup() -> Path:
    """Write a consistent snapshot of app.db plus the uploads directory into a temp ZIP."""
    settings = get_settings()
    tmp_dir = Path(tempfile.mkdtemp(prefix="lp-backup-"))
    db_copy = tmp_dir / "app.db"
    src = sqlite3.connect(settings.data_dir / "app.db")
    try:
        dst = sqlite3.connect(db_copy)
        with dst:
            src.backup(dst)  # online, consistent snapshot even while the app writes
        dst.close()
    finally:
        src.close()
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    zip_path = tmp_dir / f"learning-backup-{stamp}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr(
            MANIFEST,
            json.dumps(
                {
                    "version": BACKUP_VERSION,
                    "created_at": datetime.now(UTC).isoformat(),
                    "app": "learning-platform",
                }
            ),
        )
        zf.write(db_copy, "app.db")
        uploads = settings.uploads_dir
        for file in uploads.rglob("*"):
            if (
                file.is_file() and "pages" not in file.relative_to(uploads).parts
            ):  # page previews are a cache
                zf.write(file, f"uploads/{file.relative_to(uploads).as_posix()}")
    db_copy.unlink(missing_ok=True)
    return zip_path


def inspect_backup(zip_path: Path) -> dict:
    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        if MANIFEST not in names or "app.db" not in names:
            raise ValueError("Not a learning-platform backup (manifest.json or app.db missing).")
        manifest = json.loads(zf.read(MANIFEST))
        if manifest.get("app") != "learning-platform":
            raise ValueError("Not a learning-platform backup.")
        files = sum(1 for n in names if n.startswith("uploads/"))
        return {
            "manifest": manifest,
            "upload_files": files,
            "db_bytes": zf.getinfo("app.db").file_size,
        }


def restore_backup(zip_path: Path) -> dict:
    """Replace the current database and uploads with the backup's. The previous data is kept as *.bak-<stamp>."""
    settings = get_settings()
    info = inspect_backup(zip_path)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    data = settings.data_dir
    staging = data / f"restore-{stamp}"
    staging.mkdir()
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            target = (staging / member).resolve()
            if staging.resolve() not in target.parents:
                raise ValueError("Backup contains unsafe paths.")
        zf.extractall(staging)
    # sanity: the extracted db must open and contain alembic_version
    con = sqlite3.connect(staging / "app.db")
    try:
        con.execute("SELECT version_num FROM alembic_version").fetchone()
    finally:
        con.close()

    # Copy the current database aside, then overwrite the live file's *contents* with the SQLite
    # online-backup API. This works with open connections and on Windows (no file renames).
    current_db = data / "app.db"
    if current_db.exists():
        live = sqlite3.connect(current_db)
        try:
            keep = sqlite3.connect(data / f"app.db.bak-{stamp}")
            with keep:
                live.backup(keep)
            keep.close()
            restored = sqlite3.connect(staging / "app.db")
            try:
                with live:
                    restored.backup(live)
            finally:
                restored.close()
        finally:
            live.close()
    else:
        shutil.move(staging / "app.db", current_db)
    dbm.reset_engine_for_tests()  # pooled connections must reopen on the restored schema
    if settings.uploads_dir.exists():
        shutil.move(settings.uploads_dir, data / f"uploads.bak-{stamp}")
    if (staging / "uploads").exists():
        shutil.move(staging / "uploads", settings.uploads_dir)
    settings.uploads_dir.mkdir(exist_ok=True)
    shutil.rmtree(staging, ignore_errors=True)

    dbm.run_migrations()  # bring an older backup up to date
    from app.services.search import reindex_all

    with dbm.get_sessionmaker()() as session:
        reindex_all(session)
    return {**info, "previous_kept_as": f"app.db.bak-{stamp}"}


def data_stats() -> dict:
    settings = get_settings()
    db_path = settings.data_dir / "app.db"
    uploads = (
        sum(f.stat().st_size for f in settings.uploads_dir.rglob("*") if f.is_file())
        if settings.uploads_dir.exists()
        else 0
    )
    backups = sorted(p.name for p in settings.data_dir.glob("app.db.bak-*"))
    return {
        "db_bytes": db_path.stat().st_size if db_path.exists() else 0,
        "uploads_bytes": uploads,
        "previous_backups": backups,
    }
