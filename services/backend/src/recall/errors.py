"""Stable machine-readable errors (docs/API-CONTRACT.md "Operational errors")."""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status: int,
        *,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable
        self.details = details


def unauthenticated(message: str = "Sign in again.") -> ApiError:
    return ApiError("UNAUTHENTICATED", message, 401)


def rate_limited(message: str = "Too many attempts. Wait and try again.") -> ApiError:
    return ApiError("RATE_LIMITED", message, 429, retryable=True)


def forbidden(message: str = "You do not have access to this.") -> ApiError:
    return ApiError("FORBIDDEN", message, 403)


def not_found(what: str = "Not found.") -> ApiError:
    # Cross-workspace resources are indistinguishable from nonexistent ones on purpose.
    return ApiError("NOT_FOUND", what, 404)


def validation(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError("VALIDATION_ERROR", message, 422, details=details)


def unsupported_media(message: str) -> ApiError:
    return ApiError("UNSUPPORTED_MEDIA", message, 415)


def payload_too_large(message: str) -> ApiError:
    return ApiError("PAYLOAD_TOO_LARGE", message, 413)


def hash_mismatch(message: str) -> ApiError:
    return ApiError("HASH_MISMATCH", message, 422)


def upload_incomplete(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError("UPLOAD_INCOMPLETE", message, 409, retryable=True, details=details)


def idempotency_conflict() -> ApiError:
    return ApiError(
        "IDEMPOTENCY_CONFLICT",
        "This idempotency key or capture ID was already used for a different request.",
        409,
    )


def source_unavailable(message: str = "The original is not available yet.") -> ApiError:
    return ApiError("SOURCE_UNAVAILABLE", message, 409, retryable=True)
