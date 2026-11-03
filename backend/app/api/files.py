from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.core.deps import CurrentUser, SettingsDep

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{path:path}")
def serve(path: str, _: CurrentUser, settings: SettingsDep) -> FileResponse:
    root = settings.uploads_dir.resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return FileResponse(target, headers={"Cache-Control": "private, max-age=86400"})
