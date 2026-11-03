import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

os.environ.setdefault("APP_PASSWORD", "test-password")
os.environ.setdefault("SECRET_KEY", "test-secret-key-0123456789abcdef")
os.environ.setdefault("COOKIE_SECURE", "false")


@pytest.fixture(autouse=True)
def _isolated_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from app.core import config, db, security

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    config.get_settings.cache_clear()
    db.reset_engine_for_tests()
    db.run_migrations()
    security.login_limiter._attempts.clear()
    yield
    db.reset_engine_for_tests()
    config.get_settings.cache_clear()


@pytest.fixture
def db_session() -> Iterator[Session]:
    from app.core.db import get_sessionmaker

    with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def client() -> Iterator[TestClient]:
    from app.main import create_app

    app = create_app()
    with TestClient(app, headers={"X-Requested-With": "fetch"}) as c:
        yield c


@pytest.fixture
def auth_client(client: TestClient) -> TestClient:
    r = client.post("/api/auth/login", json={"password": "test-password"})
    assert r.status_code == 200, r.text
    return client


FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")
