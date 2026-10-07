"""Environment-driven configuration. Secrets come from the environment only, never from Git."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

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

    # Browser/webview origins allowed to call the API (e.g. the Tauri desktop app). Empty = none.
    cors_allow_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=list, validation_alias="RECALL_CORS_ORIGINS"
    )

    capture_schema_path: Path | None = Field(None, validation_alias="RECALL_CAPTURE_SCHEMA_PATH")

    # ---- RCL-002: AI processing. Every value must be set (and workspace consent given) before any
    # private content is sent to a provider. Nothing here has a "convenient" default.
    ai_provider: Literal["anthropic"] | None = Field(None, validation_alias="AI_PROVIDER")
    ai_model_id: str | None = Field(None, validation_alias="AI_MODEL_ID")
    ai_api_key: str | None = Field(None, validation_alias="AI_API_KEY", repr=False)
    ai_effort: Literal["low", "medium", "high", "xhigh", "max"] = Field("high", validation_alias="AI_EFFORT")
    ai_refusal_fallback: bool = Field(True, validation_alias="AI_REFUSAL_FALLBACK")
    ai_input_usd_per_mtok: float | None = Field(None, validation_alias="AI_INPUT_USD_PER_MTOK")
    ai_output_usd_per_mtok: float | None = Field(None, validation_alias="AI_OUTPUT_USD_PER_MTOK")
    ai_daily_budget_usd: float | None = Field(None, validation_alias="RECALL_AI_DAILY_BUDGET_USD")
    ai_monthly_budget_usd: float | None = Field(None, validation_alias="RECALL_AI_MONTHLY_BUDGET_USD")
    ai_image_max_edge: int = Field(2000, validation_alias="AI_IMAGE_MAX_EDGE")
    max_processing_attempts: int = Field(3, validation_alias="RECALL_MAX_PROCESSING_ATTEMPTS")
    worker_database_url: str | None = Field(None, validation_alias="RECALL_WORKER_DATABASE_URL")
    worker_lease_seconds: int = Field(900, validation_alias="RECALL_WORKER_LEASE_SECONDS")

    # RCL-003B semantic retrieval. These deliberately have no defaults: enabling the
    # workspace index cannot silently start sending private text to another provider.
    embedding_provider: Literal["voyage"] | None = Field(None, validation_alias="RECALL_EMBEDDING_PROVIDER")
    embedding_model_id: str | None = Field(None, validation_alias="RECALL_EMBEDDING_MODEL_ID")
    embedding_api_key: str | None = Field(None, validation_alias="RECALL_EMBEDDING_API_KEY", repr=False)
    embedding_dimensions: int | None = Field(None, validation_alias="RECALL_EMBEDDING_DIMENSIONS")
    embedding_version: str | None = Field(None, validation_alias="RECALL_EMBEDDING_VERSION")
    embedding_input_usd_per_mtok: float | None = Field(None, validation_alias="RECALL_EMBEDDING_INPUT_USD_PER_MTOK")
    embedding_max_batch_tokens: int = Field(4096, validation_alias="RECALL_EMBEDDING_MAX_BATCH_TOKENS")

    @property
    def ai_configured(self) -> bool:
        return bool(
            self.ai_provider
            and self.ai_model_id
            and self.ai_api_key
            and self.ai_input_usd_per_mtok is not None
            and self.ai_output_usd_per_mtok is not None
            and self.ai_daily_budget_usd is not None
            and self.ai_monthly_budget_usd is not None
        )

    @property
    def ai_policy_version(self) -> str:
        """Bumped whenever what is sent to the provider, or to whom, changes; consent is per version."""
        semantic = (
            f"+{self.embedding_provider}:{self.embedding_model_id}:{self.embedding_version}"
            if self.embedding_configured
            else ""
        )
        return f"{self.ai_provider or 'none'}-v1{semantic}"

    @property
    def embedding_configured(self) -> bool:
        return bool(
            self.embedding_provider
            and self.embedding_model_id
            and self.embedding_api_key
            and self.embedding_dimensions
            and self.embedding_version
            and self.embedding_input_usd_per_mtok is not None
            and self.ai_daily_budget_usd is not None
            and self.ai_monthly_budget_usd is not None
        )

    @property
    def provider_processing_configured(self) -> bool:
        return self.ai_configured or self.embedding_configured

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("["):
                return json.loads(value)
            return [o.strip() for o in value.split(",") if o.strip()]
        return value

    @model_validator(mode="after")
    def _validate(self) -> Settings:
        if "*" in self.cors_allow_origins:
            raise ValueError("RECALL_CORS_ORIGINS must list explicit origins, never '*'")
        if len(self.signing_secret) < 32:
            raise ValueError("RECALL_SIGNING_SECRET must be at least 32 characters")
        if bool(self.auth_jwks_url) == bool(self.auth_jwt_secret):
            raise ValueError("configure exactly one of RECALL_AUTH_JWKS_URL or RECALL_AUTH_JWT_SECRET")
        if self.auth_jwt_secret is not None and len(self.auth_jwt_secret) < 32:
            raise ValueError("RECALL_AUTH_JWT_SECRET must be at least 32 characters")
        if self.storage_backend == "supabase" and not (self.supabase_url and self.supabase_service_role_key):
            raise ValueError("supabase storage needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        if not 1 <= self.max_processing_attempts <= 10:
            raise ValueError("RECALL_MAX_PROCESSING_ATTEMPTS must be 1-10")
        for name in ("ai_input_usd_per_mtok", "ai_output_usd_per_mtok", "ai_daily_budget_usd", "ai_monthly_budget_usd"):
            value = getattr(self, name)
            if value is not None and value < 0:
                raise ValueError(f"{name} must be >= 0")
        if self.embedding_input_usd_per_mtok is not None and self.embedding_input_usd_per_mtok < 0:
            raise ValueError("embedding_input_usd_per_mtok must be >= 0")
        if self.embedding_dimensions is not None and self.embedding_dimensions < 1:
            raise ValueError("embedding_dimensions must be >= 1")
        if not 1 <= self.embedding_max_batch_tokens <= 100_000:
            raise ValueError("embedding_max_batch_tokens must be 1-100000")
        if self.max_pages_per_capture > 10 or self.max_page_bytes > 25 * MIB:
            raise ValueError("limits may not exceed the capture schema maxima (10 pages, 25 MiB)")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
