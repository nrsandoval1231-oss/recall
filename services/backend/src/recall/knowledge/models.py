from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SHA256 = re.compile(r"^[0-9a-f]{64}$")
MAX_TEXT = 256 * 1024
MAX_SOURCES = 10_000
MAX_SNAPSHOT = 16 * 1024 * 1024


def _uuid(value: str) -> str:
    return str(uuid.UUID(value))


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    revision: int = Field(ge=1)
    source_sha256: str
    note_sha256: str
    text: str = Field(max_length=MAX_TEXT)
    source_name: str = Field(min_length=1, max_length=512)
    note_path: str = Field(min_length=1, max_length=2048)
    captured_at: datetime
    updated_at: datetime

    @field_validator("id")
    @classmethod
    def valid_id(cls, value: str) -> str:
        return _uuid(value)

    @field_validator("source_sha256", "note_sha256")
    @classmethod
    def valid_hash(cls, value: str) -> str:
        if not SHA256.fullmatch(value):
            raise ValueError("must be a lowercase SHA-256 hex digest")
        return value

    @model_validator(mode="after")
    def content_hash_matches(self) -> Source:
        if hashlib.sha256(self.text.encode("utf-8")).hexdigest() != self.note_sha256:
            raise ValueError("note_sha256 does not match supplied note text")
        return self


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    scope: str
    generation: int = Field(ge=1)
    processing_allowed: bool
    sources: list[Source] = Field(max_length=MAX_SOURCES)
    eligible_ids: list[str] = Field(max_length=MAX_SOURCES)
    suppressed_facts: list[str] = Field(max_length=10_000)
    rebuild: bool = False

    @field_validator("scope")
    @classmethod
    def valid_scope(cls, value: str) -> str:
        return _uuid(value)

    @field_validator("eligible_ids")
    @classmethod
    def valid_eligible_ids(cls, values: list[str]) -> list[str]:
        ids = [_uuid(value) for value in values]
        if len(ids) != len(set(ids)):
            raise ValueError("eligible_ids must be unique")
        return ids

    @model_validator(mode="after")
    def source_invariants(self) -> Snapshot:
        ids = [source.id for source in self.sources]
        if len(ids) != len(set(ids)):
            raise ValueError("sources must be unique")
        if not set(self.eligible_ids).issubset(ids):
            raise ValueError("eligible_ids must refer to included sources")
        if not self.processing_allowed and self.eligible_ids:
            raise ValueError("disabled processing requires empty eligible_ids")
        return self


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    scope: str
    generation: int = Field(ge=1)
    query: str = Field(max_length=4096)
    limit: int = Field(default=20, ge=1, le=50)
    include_history: bool = False

    @field_validator("scope")
    @classmethod
    def valid_scope(cls, value: str) -> str:
        return _uuid(value)


class Support(BaseModel):
    source_id: str
    revision: int
    source_sha256: str
    note_sha256: str
    quote: str


class Relationship(BaseModel):
    id: str
    subject_id: str
    object_id: str
    source_id: str
    revision: int
    source_sha256: str
    note_sha256: str
    source_name: str
    note_path: str
    quote: str
    subject: str
    subject_type: str
    predicate: str
    object: str
    object_type: str
    fact: str
    valid_at: datetime | None = None
    invalid_at: datetime | None = None
    extracted_at: datetime
    inferred: Literal[True] = True
    uncertainty: str
    related_source_ids: list[str] = Field(default_factory=list)
    supports: list[Support]


class Status(BaseModel):
    state: str
    pending: int = 0
    indexed: int = 0
    failed: int = 0
    message: str = ""
    providers: dict[str, str] | None = None


class SearchResponse(BaseModel):
    status: Status
    relationships: list[Relationship]
