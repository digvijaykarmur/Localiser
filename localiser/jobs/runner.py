"""Async job runner with SSE progress."""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any, AsyncIterator, Callable

from localiser.db import Chapter, Job, Page, Series, get_session_factory, utcnow
from localiser.pipeline import bible as bible_mod
from localiser.pipeline import clean as clean_mod
from localiser.pipeline import detect as detect_mod
from localiser.pipeline import export as export_mod
from localiser.pipeline import ocr as ocr_mod
from localiser.pipeline import story as story_mod
from localiser.pipeline import translate as translate_mod
from localiser.pipeline import typeset as typeset_mod
from localiser.util import log, new_id
from localiser.util.paths import series_dir
from localiser.util import read_json

_queues: dict[str, asyncio.Queue] = defaultdict(asyncio.Queue)
_tasks: dict[str, asyncio.Task] = {}


def create_job(kind: str, scope_id: str, total: int | None = None) -> Job:
    Session = get_session_factory()
    with Session() as db:
        job = Job(
            id=new_id(),
            kind=kind,
            scope_id=scope_id,
            state="queued",
            progress=0.0,
            total=total,
            completed=0,
            started_at=None,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        # detach
        db.expunge(job)
        return job


async def emit(job_id: str, event: dict[str, Any]) -> None:
    await _queues[job_id].put(event)


async def events(job_id: str) -> AsyncIterator[str]:
    q = _queues[job_id]
    while True:
        event = await q.get()
        yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        if event.get("type") in ("done", "failed", "cancelled"):
            break


def enqueue(coro_factory: Callable[[], Any], job_id: str) -> None:
    async def runner():
        Session = get_session_factory()
        with Session() as db:
            job = db.get(Job, job_id)
            if job:
                job.state = "running"
                job.started_at = utcnow()
                db.commit()
        await emit(job_id, {"type": "started", "job_id": job_id})
        try:
            await coro_factory()
            with Session() as db:
                job = db.get(Job, job_id)
                if job:
                    job.state = "done"
                    job.progress = 1.0
                    job.finished_at = utcnow()
                    db.commit()
            await emit(job_id, {"type": "done", "job_id": job_id})
        except Exception as e:  # noqa: BLE001
            log.error("job_failed", job_id=job_id, error=str(e))
            with Session() as db:
                job = db.get(Job, job_id)
                if job:
                    job.state = "failed"
                    job.error = str(e)
                    job.finished_at = utcnow()
                    db.commit()
            await emit(job_id, {"type": "failed", "job_id": job_id, "error": str(e)})

    _tasks[job_id] = asyncio.create_task(runner())


async def run_chapter_stages(chapter_id: str, stages: list[str], job_id: str) -> None:
    Session = get_session_factory()
    with Session() as db:
        chapter = db.get(Chapter, chapter_id)
        if not chapter:
            raise ValueError("chapter not found")
        series = db.get(Series, chapter.series_id)
        if not series:
            raise ValueError("series not found")
        # snapshot ids
        series_id = series.id
        ch_number = chapter.number
        pages = (
            db.query(Page)
            .filter(Page.chapter_id == chapter_id, Page.skip_processing == 0)
            .order_by(Page.index_in_ch)
            .all()
        )
        page_ids = [p.id for p in pages]
        reading_dir = series.reading_dir
        page_format = series.format
        fonts = {}
        cfg_path = series_dir(series_id) / "series.json"
        if cfg_path.exists():
            fonts = read_json(cfg_path).get("fonts", {})
        clean_cfg = read_json(cfg_path).get("clean", {}) if cfg_path.exists() else {}

    total_steps = max(1, len(stages) * max(1, len(page_ids)))
    done = 0

    async def tick(msg: str):
        nonlocal done
        done += 1
        with Session() as db:
            job = db.get(Job, job_id)
            if job:
                job.completed = done
                job.total = total_steps
                job.progress = done / total_steps
                db.commit()
        await emit(job_id, {"type": "progress", "message": msg, "progress": done / total_steps})

    for stage in stages:
        if stage == "analyze":
            for pid in page_ids:
                with Session() as db:
                    page = db.get(Page, pid)
                    await detect_mod.analyze_page(
                        db,
                        page,
                        series_id=series_id,
                        chapter_number=ch_number,
                        reading_dir=reading_dir,
                        page_format=page_format,
                        job_id=job_id,
                    )
                    await ocr_mod.ocr_page(
                        db,
                        page,
                        series_id=series_id,
                        chapter_number=ch_number,
                        job_id=job_id,
                    )
                await tick(f"analyzed {pid}")
            with Session() as db:
                ch = db.get(Chapter, chapter_id)
                if ch:
                    ch.state = "analyzed"
                    db.commit()

        elif stage == "bible":
            with Session() as db:
                series = db.get(Series, series_id)
                chapter = db.get(Chapter, chapter_id)
                if chapter.number == min(
                    c.number
                    for c in db.query(Chapter).filter(Chapter.series_id == series_id).all()
                ):
                    await bible_mod.build_bible_chapter1(db, series, job_id=job_id)
                else:
                    if series.bible_locked:
                        await bible_mod.extend_bible(db, series, chapter, job_id=job_id)
            await tick("bible")

        elif stage == "translate":
            with Session() as db:
                series = db.get(Series, series_id)
                chapter = db.get(Chapter, chapter_id)
                await translate_mod.translate_chapter(db, series, chapter, job_id=job_id)
            await tick("translate")

        elif stage == "clean":
            for pid in page_ids:
                with Session() as db:
                    page = db.get(Page, pid)
                    clean_mod.clean_page(
                        db,
                        page,
                        series_id=series_id,
                        chapter_number=ch_number,
                        include_sfx=bool(clean_cfg.get("include_sfx", False)),
                        max_tier=int(clean_cfg.get("max_tier", 3)),
                        risk_abort=float(clean_cfg.get("risk_abort", 0.85)),
                    )
                await tick(f"cleaned {pid}")

        elif stage == "typeset":
            for pid in page_ids:
                with Session() as db:
                    page = db.get(Page, pid)
                    await typeset_mod.typeset_page(
                        db,
                        page,
                        series_id=series_id,
                        chapter_number=ch_number,
                        fonts=fonts,
                    )
                    clean_mod.compose_page(
                        db, page, series_id=series_id, chapter_number=ch_number
                    )
                await tick(f"typeset {pid}")

        elif stage == "story":
            with Session() as db:
                series = db.get(Series, series_id)
                chapter = db.get(Chapter, chapter_id)
                await story_mod.generate_story(db, series, chapter, job_id=job_id)
            await tick("story")

        elif stage == "export":
            with Session() as db:
                export_mod.export_series(db, series_id)
            await tick("export")

        else:
            await emit(job_id, {"type": "log", "message": f"Unknown stage skipped: {stage}"})
