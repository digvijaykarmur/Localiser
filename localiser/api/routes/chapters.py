from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from localiser.db import Chapter, Page, Series, get_db
from localiser.jobs.runner import create_job, enqueue, run_chapter_stages
from localiser.pipeline import story as story_mod
from localiser.schemas import RunChapterRequest
from localiser.util import read_json
from localiser.util.paths import chapter_dir

router = APIRouter(tags=["chapters"])


@router.get("/chapters")
def list_chapters(series_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(Chapter)
        .filter(Chapter.series_id == series_id)
        .order_by(Chapter.number)
        .all()
    )
    out = []
    for ch in rows:
        pages = db.query(Page).filter(Page.chapter_id == ch.id).all()
        out.append(
            {
                "id": ch.id,
                "number": ch.number,
                "title_src": ch.title_src,
                "title_hi": ch.title_hi,
                "page_count": ch.page_count,
                "state": ch.state,
                "story_words": ch.story_words,
                "pages": [
                    {
                        "id": p.id,
                        "index": p.index_in_ch,
                        "state": p.state,
                        "flagged": bool(p.flagged),
                    }
                    for p in sorted(pages, key=lambda x: x.index_in_ch)
                ],
            }
        )
    return out


@router.post("/chapters/{chapter_id}/run")
async def run_chapter(
    chapter_id: str, body: RunChapterRequest, db: Session = Depends(get_db)
):
    ch = db.get(Chapter, chapter_id)
    if not ch:
        raise HTTPException(404, "Chapter not found")
    series = db.get(Series, ch.series_id)
    if not series:
        raise HTTPException(404, "Series not found")

    needs_bible = any(s in body.stages for s in ("translate", "story"))
    if needs_bible and not series.bible_locked:
        raise HTTPException(
            400,
            "Bible must be locked before translate/story. Open Bible Editor and Lock Bible.",
        )
    if not body.confirm_cost:
        # rough estimate
        pages = db.query(Page).filter(Page.chapter_id == chapter_id).count()
        estimate = {
            "pages": pages,
            "approx_calls": pages * 12,
            "message": "Confirm cost to start. Set confirm_cost=true.",
            "models": __import__("localiser.config", fromlist=["get_settings"]).get_settings().models,
        }
        return {"needs_confirm": True, "estimate": estimate}

    job = create_job("chapter_run", chapter_id)
    stages = list(body.stages)

    def factory():
        return run_chapter_stages(chapter_id, stages, job.id)

    enqueue(factory, job.id)
    return {"job_id": job.id, "stages": stages}


@router.get("/chapters/{chapter_id}/story")
def get_story(chapter_id: str, db: Session = Depends(get_db)):
    ch = db.get(Chapter, chapter_id)
    if not ch:
        raise HTTPException(404, "Chapter not found")
    path = chapter_dir(ch.series_id, ch.number) / "story.md"
    meta_path = chapter_dir(ch.series_id, ch.number) / "story.meta.json"
    return {
        "markdown": path.read_text(encoding="utf-8") if path.exists() else "",
        "meta": read_json(meta_path) if meta_path.exists() else {},
        "words": ch.story_words,
    }


@router.post("/chapters/{chapter_id}/story/regen")
async def regen_story(chapter_id: str, body: dict, db: Session = Depends(get_db)):
    ch = db.get(Chapter, chapter_id)
    if not ch:
        raise HTTPException(404)
    series = db.get(Series, ch.series_id)
    if not series or not series.bible_locked:
        raise HTTPException(400, "Bible must be locked")
    from localiser.jobs.runner import create_job, enqueue

    job = create_job("story", chapter_id)
    hint = body.get("hint")

    async def factory():
        Session = __import__("localiser.db", fromlist=["get_session_factory"]).get_session_factory()
        with Session() as sdb:
            chapter = sdb.get(Chapter, chapter_id)
            ser = sdb.get(Series, chapter.series_id)
            await story_mod.generate_story(sdb, ser, chapter, job_id=job.id, hint=hint)

    enqueue(factory, job.id)
    return {"job_id": job.id}
