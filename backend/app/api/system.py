import logging
import shutil
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.core.deps import DB, CurrentUser
from app.models.exercise import Exercise, ExerciseNodeLink, ExercisePart
from app.schemas.api import BackupInfoOut, ExerciseOut, RestoreOut
from app.services import backup as backupsvc
from app.services import generation
from app.services import search as searchsvc
from app.services.jobs import runner

log = logging.getLogger("app.system")
router = APIRouter(prefix="/system", tags=["system"])


@router.get("/stats", response_model=BackupInfoOut)
def stats(_: CurrentUser) -> BackupInfoOut:
    return BackupInfoOut(**backupsvc.data_stats())


@router.get("/backup")
def backup(_: CurrentUser) -> FileResponse:
    zip_path = backupsvc.create_backup()
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=zip_path.name,
        background=BackgroundTask(shutil.rmtree, zip_path.parent, True),
    )


@router.post("/restore", response_model=RestoreOut)
async def restore(_: CurrentUser, file: Annotated[UploadFile, File()]) -> RestoreOut:
    tmp = Path(tempfile.mkdtemp(prefix="lp-restore-")) / (file.filename or "backup.zip")
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                out.write(chunk)
        try:
            backupsvc.inspect_backup(tmp)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
        await runner.shutdown()
        result = backupsvc.restore_backup(tmp)
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)
    log.warning(
        "Database restored from backup; previous data kept as %s", result["previous_kept_as"]
    )
    return RestoreOut(
        created_at=result["manifest"].get("created_at"),
        upload_files=result["upload_files"],
        db_bytes=result["db_bytes"],
        previous_kept_as=result["previous_kept_as"],
    )


@router.post("/reindex")
def reindex(db: DB, _: CurrentUser) -> dict[str, int]:
    return {"indexed": searchsvc.reindex_all(db)}


@router.post("/exercises/{exercise_id}/similar", response_model=ExerciseOut)
async def similar_exercise(exercise_id: int, db: DB, user: CurrentUser) -> ExerciseOut:
    from app.api.exercises import _exercise_out, _get_exercise

    ex = _get_exercise(db, exercise_id, user.id)
    try:
        variation, _usage = await generation.generate_variation(ex)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    new = Exercise(
        subject_id=ex.subject_id,
        number=None,
        title=variation.title[:200],
        statement=variation.statement,
        hints=variation.hints,
        solution=variation.solution,
        difficulty=variation.difficulty or ex.difficulty,
        tags=["generated"],
        source_label=f"Variation of {ex.number + ' ' if ex.number else ''}{ex.title}"[:200],
    )
    new.parts = [
        ExercisePart(label=p.label, statement=p.statement, solution=p.solution, sort_order=i)
        for i, p in enumerate(variation.parts)
    ]
    new.node_links = [ExerciseNodeLink(node_id=link.node_id) for link in ex.node_links]
    db.add(new)
    db.flush()
    searchsvc.index_exercise(db, new)
    db.commit()
    return _exercise_out(db, _get_exercise(db, new.id, user.id))
