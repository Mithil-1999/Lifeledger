"""Application settings loaded from environment variables (and optional .env files).

Values are read from the process environment first, then from `backend/.env`,
then from the repository-root `.env`. Real secrets must never be committed.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent

INSECURE_SECRET_PLACEHOLDER = "change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Later files take precedence; real environment variables override both.
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "LifeVault API"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False

    database_url: str = Field(
        default="postgresql+psycopg://lifevault:lifevault@localhost:5432/lifevault",
        description="SQLAlchemy URL. Use the psycopg (v3) driver: postgresql+psycopg://...",
    )
    app_secret_key: str = Field(default=INSECURE_SECRET_PLACEHOLDER, min_length=8)

    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"
    # Comma-separated extra origins allowed by CORS (in addition to FRONTEND_URL).
    cors_extra_origins: str = ""

    default_currency: str = "NPR"

    @field_validator("database_url")
    @classmethod
    def _normalize_driver(cls, value: str) -> str:
        # Accept plain postgres URLs and pin them to the psycopg v3 driver.
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @model_validator(mode="after")
    def _check_production_secrets(self) -> "Settings":
        if self.environment == "production":
            if self.app_secret_key == INSECURE_SECRET_PLACEHOLDER or len(self.app_secret_key) < 32:
                raise ValueError(
                    "APP_SECRET_KEY must be set to a random value of at least 32 characters in production."
                )
            if self.debug:
                raise ValueError("DEBUG must be false in production.")
        return self

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.frontend_url.rstrip("/")]
        origins += [o.strip().rstrip("/") for o in self.cors_extra_origins.split(",") if o.strip()]
        return list(dict.fromkeys(origins))


@lru_cache
def get_settings() -> Settings:
    return Settings()
