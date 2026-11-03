import time

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.core.deps import DB, CurrentUser, SettingsDep
from app.core.security import (
    create_session,
    destroy_session,
    ensure_owner_user,
    login_limiter,
    verify_password,
)
from app.schemas.api import LoginRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    return (
        forwarded.split(",")[0].strip()
        if forwarded
        else request.client.host
        if request.client
        else "unknown"
    )


@router.post("/login", response_model=UserOut)
def login(
    body: LoginRequest, request: Request, response: Response, db: DB, settings: SettingsDep
) -> UserOut:
    key = _client_key(request)
    if login_limiter.is_blocked(key):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again in a minute."
        )
    if not verify_password(body.password):
        login_limiter.record_failure(key)
        time.sleep(0.5)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong password.")
    login_limiter.reset(key)
    user = ensure_owner_user(db)
    token = create_session(db, user, request.headers.get("user-agent", ""))
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=settings.session_ttl_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return UserOut.model_validate(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DB, settings: SettingsDep) -> Response:
    destroy_session(db, request.cookies.get(settings.cookie_name))
    response.delete_cookie(settings.cookie_name, path="/")
    return Response(status_code=204)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
