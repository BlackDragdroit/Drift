from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    app_password: str = Field(min_length=1)
    secret_key: str = Field(min_length=16)

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-5-5"

    data_dir: Path = Path("./data")
    static_dir: Path | None = None

    cookie_secure: bool = True
    cookie_name: str = "lp_session"
    session_ttl_days: int = 30
    max_upload_mb: int = 50
    extract_chunk_pages: int = 8
    log_level: str = "info"

    @field_validator("data_dir", mode="after")
    @classmethod
    def _ensure_dirs(cls, value: Path) -> Path:
        value.mkdir(parents=True, exist_ok=True)
        (value / "uploads").mkdir(exist_ok=True)
        return value

    @property
    def database_url(self) -> str:
        return f"sqlite:///{(self.data_dir / 'app.db').as_posix()}"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
