from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from localiser.db import Chapter, Page, Series, get_db
from localiser.jobs.runner import create_job, enqueue, run_chapter_stages
from localiser.pipeline.ingest import ingest_series
from localiser.schemas import CreateSeriesRequest
from localiser.util.paths import series_dir
from localiser.util import read_json

router = APIRouter(tags=["series"])


@router.post("/series")
def create_series(body: CreateSeriesRequest, db: Session = Depends(get_db)):
    try:
        series = ingest_series(
            db,
            title=body.title,
            title_hi=body.title_hi,
            input_path=body.input_path,
            reading_dir=body.reading_dir,
            format_hint=body.format,
            name_policy=body.name_policy,
            rights_status=body.rights_status,
        )
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e)) from e
    return _series_payload(db, series)


@router.get("/series")
def list_series(db: Session = Depends(get_db)):
    rows = db.query(Series).order_by(Series.created_at.desc()).all()
    return [_series_payload(db, s) for s in rows]


@router.get("/series/{series_id}")
def get_series(series_id: str, db: Session = Depends(get_db)):
    s = db.get(Series, series_id)
    if not s:
        raise HTTPException(404, "Series not found")
    return _series_payload(db, s)


def _series_payload(db: Session, s: Series) -> dict:
    chapters = db.query(Chapter).filter(Chapter.series_id == s.id).all()
    pages = 0
    done = 0
    for ch in chapters:
        ps = db.query(Page).filter(Page.chapter_id == ch.id).all()
        pages += len(ps)
        done += sum(1 for p in ps if p.state in ("approved", "composited", "typeset"))
    cover = None
    if chapters:
        first = sorted(chapters, key=lambda c: c.number)[0]
        p0 = (
            db.query(Page)
            .filter(Page.chapter_id == first.id)
            .order_by(Page.index_in_ch)
            .first()
        )
        if p0:
            cover = f"/api/pages/{p0.id}/image/original"
    return {
        "id": s.id,
        "title": s.title,
        "title_hi": s.title_hi,
        "input_path": s.input_path,
        "reading_dir": s.reading_dir,
        "format": s.format,
        "bible_locked": bool(s.bible_locked),
        "bible_version": s.bible_version,
        "rights_status": s.rights_status,
        "chapter_count": len(chapters),
        "page_count": pages,
        "progress": (done / pages) if pages else 0,
        "cover": cover,
    }
