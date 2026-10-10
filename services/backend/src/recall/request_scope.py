"""Request-scoped device session, copied into worker threads by the ASGI server."""

from __future__ import annotations

import uuid
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class DeviceScope:
    session_id: uuid.UUID
    user_id: uuid.UUID
    workspace_id: uuid.UUID


device_scope: ContextVar[DeviceScope | None] = ContextVar("recall_device_scope", default=None)
rejected_device_session: ContextVar[bool] = ContextVar("recall_rejected_device_session", default=False)
