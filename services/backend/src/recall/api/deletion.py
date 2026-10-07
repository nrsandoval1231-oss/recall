from collections.abc import Callable
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, FastAPI, Header

from ..db.database import Database
from ..domain.deletion import DeletionService
from ..errors import validation
from .auth import Principal


def register_routes(app: FastAPI, db: Database, principal: Callable[..., Principal]) -> None:
    service = DeletionService(db)

    def key(value: str) -> str:
        try:
            UUID(value)
        except ValueError:
            raise validation("Idempotency-Key must be a UUID.") from None
        return value

    @app.delete("/v1/memories/{memory_id}")
    def memory(
        who: Annotated[Principal, Depends(principal)],
        memory_id: UUID,
        operation: Annotated[str, Header(alias="Idempotency-Key")],
        version: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        return service.delete_memory(who.user_id, memory_id, key(operation), version)

    @app.delete("/v1/sources/{source_id}")
    def source(
        who: Annotated[Principal, Depends(principal)],
        source_id: UUID,
        operation: Annotated[str, Header(alias="Idempotency-Key")],
        version: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        return service.delete_source(who.user_id, source_id, key(operation), version)

    @app.get("/v1/workspace/deletion-preview")
    def preview(who: Annotated[Principal, Depends(principal)]) -> dict[str, Any]:
        return service.preview_workspace(who.user_id)

    @app.delete("/v1/workspace/data")
    def workspace(
        who: Annotated[Principal, Depends(principal)],
        operation: Annotated[str, Header(alias="Idempotency-Key")],
        version: Annotated[int, Header(alias="If-Match")],
    ) -> dict[str, Any]:
        return service.erase_workspace(who.user_id, key(operation), version)
