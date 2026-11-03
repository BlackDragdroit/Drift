import hashlib
import secrets
import threading
import time
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.base import utcnow
from app.models.user import User, UserSession


def verify_password(candidate: str) -> bool:
    expected = get_settings().app_password
    return secrets.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: User, user_agent: str = "") -> str:
    token = secrets.token_urlsafe(32)
    ttl = timedelta(days=get_settings().session_ttl_days)
    db.add(
        UserSession(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=utcnow() + ttl,
            user_agent=user_agent[:255],
        )
    )
    db.commit()
    return token


def resolve_session(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session = db.get(UserSession, hash_token(token))
    now = utcnow()
    if session is None or session.expires_at < now:
        return None
    # Sliding expiry, written at most once per hour to avoid write amplification.
    if (now - session.last_seen_at) > timedelta(hours=1):
        session.last_seen_at = now
        session.expires_at = now + timedelta(days=get_settings().session_ttl_days)
        db.commit()
    return session.user


def destroy_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))
        db.commit()


def purge_expired_sessions(db: Session) -> None:
    db.execute(delete(UserSession).where(UserSession.expires_at < utcnow()))
    db.commit()


def ensure_owner_user(db: Session) -> User:
    user = db.scalar(select(User).order_by(User.id).limit(1))
    if user is None:
        user = User(username="owner", display_name="")
        db.add(user)
        db.commit()
    return user


class LoginRateLimiter:
    """Tiny in-memory fixed-window limiter: `max_attempts` failed logins per `window` seconds per key."""

    def __init__(self, max_attempts: int = 5, window_seconds: int = 60) -> None:
        self.max_attempts = max_attempts
        self.window = window_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> None:
        self._attempts[key] = [t for t in self._attempts[key] if now - t < self.window]

    def is_blocked(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            self._prune(key, now)
            return len(self._attempts[key]) >= self.max_attempts

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(key, now)
            self._attempts[key].append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)


login_limiter = LoginRateLimiter()
