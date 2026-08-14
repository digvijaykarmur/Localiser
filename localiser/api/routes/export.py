from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from localiser.db import get_db
from localiser.pipeline.export import export_blockers, export_series
from localiser.schemas import ExportRequest

router = APIRouter(tags=["export"])


@router.get("/export/blockers")
def blockers(series_id: str, db: Session = Depends(get_db)):
    return export_blockers(db, series_id)


@router.post("/export")
def do_export(body: ExportRequest, db: Session = Depends(get_db)):
    if body.override_blockers and body.override_phrase != "EXPORT ANYWAY":
        raise HTTPException(400, 'To override, set override_phrase to "EXPORT ANYWAY"')
    try:
        path = export_series(
            db,
            body.series_id,
            include_story=body.include_story,
            include_bible=body.include_bible,
            include_qa=body.include_qa,
            override_blockers=body.override_blockers,
        )
    except RuntimeError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "path": str(path)}
