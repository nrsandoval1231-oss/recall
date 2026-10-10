"""Bind a device-session bearer to the request before route code runs."""

from __future__ import annotations

from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Receive, Scope, Send

from ..domain.enrollment import EnrollmentService
from ..request_scope import device_scope, rejected_device_session


class DeviceSessionMiddleware:
    def __init__(self, app: ASGIApp, enrollment: EnrollmentService) -> None:
        self.app = app
        self.enrollment = enrollment

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        authorization = _header(scope, "authorization")
        scope_token = None
        rejected_token = None
        try:
            if authorization and authorization.lower().startswith("bearer "):
                raw = authorization[7:].strip()
                if raw.startswith("rcs_"):
                    resolved = await run_in_threadpool(self.enrollment.resolve, raw)
                    if resolved is None:
                        rejected_token = rejected_device_session.set(True)
                    else:
                        scope_token = device_scope.set(resolved)
            await self.app(scope, receive, send)
        finally:
            if scope_token is not None:
                device_scope.reset(scope_token)
            if rejected_token is not None:
                rejected_device_session.reset(rejected_token)


def _header(scope: Scope, name: str) -> str | None:
    target = name.encode()
    for key, value in scope.get("headers", []):
        if key.lower() == target:
            decoded = bytes(value).decode()
            return decoded if isinstance(decoded, str) else None
    return None
