"""Application settings loaded from environment variables (and optional .env files).

Values are read from the process environment first, then from `backend/.env`,
then from the repository-root `.env`. Real secrets must never be committed.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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
    # Defines "today" and month boundaries for dashboards and reports.
    app_timezone: str = "Asia/Kathmandu"

    # --- Authentication -------------------------------------------------------------
    # LifeVault is a private app: disable registration once your account exists.
    registration_enabled: bool = True
    session_cookie_name: str = "lv_session"
    csrf_cookie_name: str = "lv_csrf"
    # Must be true whenever the app is served over HTTPS (enforced in production).
    cookie_secure: bool = False
    # Sessions end after this much inactivity (non-"remember me" sessions)...
    session_idle_timeout_minutes: int = Field(default=480, ge=5)
    # ...and unconditionally after this long.
    session_lifetime_hours: int = Field(default=12, ge=1)
    session_remember_me_days: int = Field(default=30, ge=1, le=90)
    password_reset_token_minutes: int = Field(default=30, ge=5, le=240)

    # --- Rate limiting ----------------------------------------------------------------
    rate_limit_enabled: bool = True
    # Only enable behind a trusted reverse proxy that sets X-Forwarded-For.
    trust_proxy_headers: bool = False

    # --- Email ------------------------------------------------------------------------
    # dev_outbox: writes emails to DEV_OUTBOX_DIR (development only, never production)
    # smtp:       sends through the SMTP server below
    # memory:     keeps emails in memory (automated tests)
    # disabled:   drops emails (password reset links cannot be delivered)
    email_backend: Literal["dev_outbox", "smtp", "memory", "disabled"] = "dev_outbox"
    dev_outbox_dir: Path = BACKEND_DIR / "var" / "dev-outbox"
    email_from: str = "LifeVault <no-reply@lifevault.local>"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True

    @field_validator("app_timezone")
    @classmethod
    def _valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"APP_TIMEZONE {value!r} is not a valid IANA timezone (e.g. Asia/Kathmandu).") from None
        return value

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)

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
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production (serve LifeVault over HTTPS).")
            if self.email_backend in ("dev_outbox", "memory"):
                raise ValueError("EMAIL_BACKEND must be 'smtp' or 'disabled' in production.")
        if self.email_backend == "smtp" and not (self.smtp_host and self.email_from):
            raise ValueError("EMAIL_BACKEND=smtp requires SMTP_HOST and EMAIL_FROM.")
        return self

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.frontend_url.rstrip("/")]
        origins += [o.strip().rstrip("/") for o in self.cors_extra_origins.split(",") if o.strip()]
        return list(dict.fromkeys(origins))


@lru_cache
def get_settings() -> Settings:
    return Settings()
