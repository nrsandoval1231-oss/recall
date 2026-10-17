"""Bind a device-session bearer to the request before route code runs."""

from __future__ import annotations

from http.cookies import SimpleCookie

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..domain.enrollment import EnrollmentService
from ..request_scope import device_scope, rejected_device_session


class DeviceSessionMiddleware:
    def __init__(self, app: ASGIApp, enrollment: EnrollmentService, allowed_origins: list[str] | None = None) -> None:
        self.app = app
        self.enrollment = enrollment
        self.allowed_origins = allowed_origins or []

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        authorization = _header(scope, "authorization")
        if not authorization:
            cookies: SimpleCookie = SimpleCookie()
            try:
                cookies.load(_header(scope, "cookie") or "")
            except Exception:
                cookies = SimpleCookie()
            session = cookies.get("megraph_session")
            if session:
                if (
                    scope.get("method") not in ("GET", "HEAD", "OPTIONS")
                    and _header(scope, "origin") not in self.allowed_origins
                ):
                    response = JSONResponse(
                        {"error": {"code": "CSRF_BLOCKED", "message": "Cross-origin request refused."}}, status_code=403
                    )
                    await response(scope, receive, send)
                    return
                authorization = "Bearer " + session.value
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

            async def private_send(message: Message) -> None:
                if message["type"] == "http.response.start" and scope.get("path", "").startswith("/v1/"):
                    message["headers"] = [
                        (k, v)
                        for k, v in message.get("headers", [])
                        if k.lower() not in (b"cache-control", b"x-content-type-options")
                    ] + [(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff")]
                await send(message)

            await self.app(scope, receive, private_send)
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
