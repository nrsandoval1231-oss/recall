"""Transport registration kept separate from the existing capture routes."""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, Query

from ..api.auth import Principal
from ..config import Settings
from ..db.database import Database
from ..domain.captures import CaptureService
from ..domain.memories import MemoryService
from ..errors import validation
from .service import SyncService


def register_routes(
    app: FastAPI,
    db: Database,
    settings: Settings,
    captures: CaptureService,
    memories: MemoryService,
    principal: Callable[..., Principal],
) -> None:
    service = SyncService(db, settings, captures, memories)

    @app.post("/v1/sync/snapshots")
    def snapshot(who: Annotated[Principal, Depends(principal)], body: Annotated[Any, Body()] = None) -> dict[str, Any]:
        if body not in (None, {}):
            raise validation("Snapshot request must be empty.")
        return service.snapshot(who.user_id)

    @app.get("/v1/sync/changes")
    def changes(
        who: Annotated[Principal, Depends(principal)],
        cursor: str | None = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
    ) -> dict[str, Any]:
        return service.changes(who.user_id, cursor, limit)

    @app.post("/v1/sync/push")
    def push(who: Annotated[Principal, Depends(principal)], body: Annotated[Any, Body()]) -> dict[str, Any]:
        return service.push(who.user_id, body)
