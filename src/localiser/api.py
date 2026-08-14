from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .config import get_settings
from .db import Chapter, Page, Series, init_db, session_scope
from .ingest import ingest_series


class SeriesCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    title_hi: str | None = Field(default=None, max_length=200)
    input_path: str
    reading_dir: Literal["ltr", "rtl"]
    format: Literal["page", "longstrip"] | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Localiser API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "local_only": True}


@app.get("/api/series")
def list_series():
    with session_scope() as db:
        rows = db.scalars(
            select(Series)
            .options(selectinload(Series.chapters).selectinload(Chapter.pages))
            .order_by(Series.created_at.desc())
        ).all()
        return [
            {
                "id": row.id,
                "title": row.title,
                "title_hi": row.title_hi,
                "format": row.format,
                "reading_dir": row.reading_dir,
                "bible_locked": row.bible_locked,
                "chapter_count": len(row.chapters),
                "page_count": sum(chapter.page_count for chapter in row.chapters),
                "cover_page_id": (
                    min(
                        (page for chapter in row.chapters for page in chapter.pages),
                        key=lambda page: (page.chapter.number, page.index_in_ch),
                    ).id
                    if any(chapter.pages for chapter in row.chapters)
                    else None
                ),
                "rights_status": row.rights_status,
            }
            for row in rows
        ]


@app.post("/api/series", status_code=201)
def create_series(payload: SeriesCreate):
    try:
        return ingest_series(
            title=payload.title,
            title_hi=payload.title_hi,
            input_path=payload.input_path,
            reading_dir=payload.reading_dir,
            format_hint=payload.format,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/series/{series_id}")
def get_series(series_id: str):
    with session_scope() as db:
        row = db.scalar(
            select(Series)
            .where(Series.id == series_id)
            .options(selectinload(Series.chapters).selectinload(Chapter.pages))
        )
        if not row:
            raise HTTPException(status_code=404, detail="Series not found")
        return {
            "id": row.id,
            "title": row.title,
            "title_hi": row.title_hi,
            "format": row.format,
            "reading_dir": row.reading_dir,
            "bible_locked": row.bible_locked,
            "chapters": [
                {
                    "id": chapter.id,
                    "number": chapter.number,
                    "title": chapter.title_src,
                    "state": chapter.state,
                    "pages": [
                        {
                            "id": page.id,
                            "index": page.index_in_ch,
                            "filename": page.src_filename,
                            "state": page.state,
                            "duplicate": page.duplicate,
                            "width": page.width,
                            "height": page.height,
                        }
                        for page in sorted(chapter.pages, key=lambda item: item.index_in_ch)
                    ],
                }
                for chapter in sorted(row.chapters, key=lambda item: item.number)
            ],
        }


def _page_file(page_id: str, image_kind: str) -> Path:
    with session_scope() as db:
        page = db.get(Page, page_id)
        if not page:
            raise HTTPException(status_code=404, detail="Page not found")
    parts = page_id.split("/")
    page_dir = (
        get_settings().workspace
        / "projects"
        / parts[0]
        / "chapters"
        / parts[1]
        / "pages"
        / parts[2]
    )
    names = {
        "original": "original.png",
        "cleaned": "clean_layer.png",
        "composite": "composite.png",
        "budget": "masks/budget.png",
    }
    path = page_dir / names[image_kind]
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{image_kind} image is not available yet")
    return path


@app.get("/api/pages/{page_id:path}/image/{image_kind}")
def page_image(page_id: str, image_kind: Literal["original", "cleaned", "composite", "budget"]):
    return FileResponse(_page_file(page_id, image_kind), media_type="image/png")
