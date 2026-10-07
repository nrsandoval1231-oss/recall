from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..db.database import Database
from ..domain.export import ExportService
from ..storage import ObjectStore
from .auth import Principal


def register_routes(app: FastAPI, db: Database, store: ObjectStore, principal: Callable[..., Principal]) -> None:
    service = ExportService(db, store)

    @app.post("/v1/exports")
    def export(who: Annotated[Principal, Depends(principal)]) -> FileResponse:
        path = service.create(who.user_id)
        return FileResponse(
            path,
            media_type="application/zip",
            filename="recall-export.zip",
            headers={"Cache-Control": "no-store"},
            background=BackgroundTask(path.unlink, missing_ok=True),
        )
