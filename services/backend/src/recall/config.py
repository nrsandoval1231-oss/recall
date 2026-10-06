"""Environment-driven configuration. Secrets come from the environment only, never from Git."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MIB = 1024 * 1024
ACCEPTED_MEDIA_TYPES = ("image/jpeg", "image/png", "image/heic", "image/heif")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    env: str = Field("development", validation_alias="RECALL_ENV")

    # Database. `database_url` MUST be a non-owner role that inherits `recall_app`.
    database_url: str = Field(validation_alias="DATABASE_URL")
    migration_database_url: str | None = Field(None, validation_alias="RECALL_MIGRATION_DATABASE_URL")

    # Auth: validate tokens issued by the provider (Supabase Auth). Never mint tokens here.
    auth_issuer: str = Field(validation_alias="RECALL_AUTH_ISSUER")
    auth_audience: str = Field("authenticated", validation_alias="RECALL_AUTH_AUDIENCE")
    auth_jwks_url: str | None = Field(None, validation_alias="RECALL_AUTH_JWKS_URL")
    # Legacy symmetric (HS256) projects only. Prefer JWKS.
    auth_jwt_secret: str | None = Field(None, validation_alias="RECALL_AUTH_JWT_SECRET")
    auto_provision_workspaces: bool = Field(True, validation_alias="RECALL_AUTO_PROVISION_WORKSPACES")

    # HMAC key for upload capabilities and list cursors (server only).
    signing_secret: str = Field(validation_alias="RECALL_SIGNING_SECRET")

    # Private object storage.
    storage_backend: Literal["local", "supabase"] = Field("local", validation_alias="RECALL_STORAGE_BACKEND")
    local_storage_dir: Path = Field(Path(".recall-storage"), validation_alias="RECALL_LOCAL_STORAGE_DIR")
    supabase_url: str | None = Field(None, validation_alias="SUPABASE_URL")
    supabase_service_role_key: str | None = Field(None, validation_alias="SUPABASE_SERVICE_ROLE_KEY")
    storage_bucket: str = Field("recall-originals-private", validation_alias="RECALL_STORAGE_BUCKET")

    # Limits (docs/API-CONTRACT.md).
    max_pages_per_capture: int = Field(10, validation_alias="RECALL_MAX_PAGES_PER_CAPTURE")
    max_page_bytes: int = Field(25 * MIB, validation_alias="RECALL_MAX_PAGE_BYTES")
    max_capture_bytes: int = Field(100 * MIB, validation_alias="RECALL_MAX_CAPTURE_BYTES")
    upload_token_ttl_seconds: int = Field(600, validation_alias="RECALL_UPLOAD_TOKEN_TTL_SECONDS")
    max_image_pixels: int = Field(120_000_000, validation_alias="RECALL_MAX_IMAGE_PIXELS")

    capture_schema_path: Path | None = Field(None, validation_alias="RECALL_CAPTURE_SCHEMA_PATH")

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        if len(self.signing_secret) < 32:
            raise ValueError("RECALL_SIGNING_SECRET must be at least 32 characters")
        if bool(self.auth_jwks_url) == bool(self.auth_jwt_secret):
            raise ValueError("configure exactly one of RECALL_AUTH_JWKS_URL or RECALL_AUTH_JWT_SECRET")
        if self.auth_jwt_secret is not None and len(self.auth_jwt_secret) < 32:
            raise ValueError("RECALL_AUTH_JWT_SECRET must be at least 32 characters")
        if self.storage_backend == "supabase" and not (self.supabase_url and self.supabase_service_role_key):
            raise ValueError("supabase storage needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        if self.max_pages_per_capture > 10 or self.max_page_bytes > 25 * MIB:
            raise ValueError("limits may not exceed the capture schema maxima (10 pages, 25 MiB)")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
