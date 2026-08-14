"""Resumable asyncio job runner with SSE progress (§3, §11.3, edge #17)."""
from __future__ import annotations

import asyncio
import json
import uuid

import structlog

from .ai.vertex import QuotaPause
from .config import CFG, SeriesConfig
from .db import Chapter, Job, PageRow, Series, now_iso, session
from .pipeline import clean as clean_mod
from .pipeline import detect, export as export_mod, group, ocr, story as story_mod
from .pipeline import translate as translate_mod, typeset as typeset_mod
from .pipeline.bible import build_bible, extend_bible, is_locked

log = structlog.get_logger()

STAGES = ["analyze", "bible", "story", "translate", "clean", "typeset", "qc"]

# per-job event queues for SSE
_queues: dict[str, asyncio.Queue] = {}
_tasks: dict[str, asyncio.Task] = {}


def _emit(job_id: str, event: dict) -> None:
    q = _queues.get(job_id)
    if q:
        q.put_nowait(event)


def subscribe(job_id: str) -> asyncio.Queue:
    q = _queues.setdefault(job_id, asyncio.Queue())
    return q


def estimate_cost(chapter_id: str, stages: list[str]) -> dict:
    """§11.3 — rough call estimate shown before any run, with Confirm."""
    with session() as s:
        pages = s.query(PageRow).filter(PageRow.chapter_id == chapter_id).count()
    calls = 0
    if "analyze" in stages:
        calls += pages * 2 + max(1, pages // 12)          # detect tiles + ocr batches
    if "translate" in stages:
        calls += pages * 5                                 # dialogue + speaker
    if "story" in stages:
        calls += pages + 4                                 # panel pass + story rounds
    if "qc" in stages:
        calls += max(1, pages // 2)
    return {"chapter_id": chapter_id, "stages": stages, "pages": pages,
            "estimated_calls": calls}


def create_job(kind: str, scope_id: str, total: int | None = None) -> str:
    job_id = uuid.uuid4().hex
    with session() as s:
        s.add(Job(id=job_id, kind=kind, scope_id=scope_id, state="queued",
                  total=total, completed=0))
    _queues.setdefault(job_id, asyncio.Queue())
    return job_id


def _set_state(job_id: str, **kw) -> None:
    with session() as s:
        j = s.get(Job, job_id)
        for k, v in kw.items():
            setattr(j, k, v)
    _emit(job_id, {"type": "state", **kw})


async def run_chapter_stages(job_id: str, chapter_id: str, stages: list[str],
                             scfg: SeriesConfig) -> None:
    _set_state(job_id, state="running", started_at=now_iso())
    try:
        with session() as s:
            pages = [p for p in (s.query(PageRow)
                                 .filter(PageRow.chapter_id == chapter_id)
                                 .order_by(PageRow.index_in_ch).all())
                     if not p.skip_processing]
        total = len(pages) * max(1, len([st for st in stages if st != "bible" and st != "story"]))
        done = 0

        for stage in [st for st in STAGES if st in stages]:
            _emit(job_id, {"type": "log", "line": f"stage {stage} started"})

            if stage == "analyze":
                for p in pages:
                    await detect.analyze_page(p.id, scfg, job_id)
                    await ocr.ocr_page(p.id, scfg, job_id)
                    await group.attribute_speakers(p.id, scfg, job_id)
                    done += 1
                    _progress(job_id, done, total, p.id)
                with session() as s:
                    s.get(Chapter, chapter_id).state = "analyzed"

            elif stage == "bible":
                with session() as s:
                    ch = s.get(Chapter, chapter_id)
                    first = (s.query(Chapter)
                             .filter(Chapter.series_id == scfg.id)
                             .order_by(Chapter.number).first())
                    is_first = ch.id == first.id
                if is_first and not is_locked(scfg.id):
                    await build_bible(scfg, job_id)
                    _emit(job_id, {"type": "log",
                                   "line": "bible draft ready — approve & lock in the Bible Editor"})
                elif not is_first:
                    await extend_bible(scfg, chapter_id, job_id)
                with session() as s:
                    s.get(Chapter, chapter_id).state = "bible_synced"

            elif stage == "story":
                res = await story_mod.generate_story(chapter_id, scfg, job_id)
                _emit(job_id, {"type": "log", "line": f"story: {res['words']} words ({res['status']})"})

            elif stage == "translate":
                for p in pages:
                    await translate_mod.translate_page(p.id, scfg, job_id)
                    done += 1
                    _progress(job_id, done, total, p.id)

            elif stage == "clean":
                for p in pages:
                    try:
                        await asyncio.to_thread(clean_mod.clean_page, p.id, scfg)
                    except Exception as e:
                        _emit(job_id, {"type": "error", "page": p.id, "error": str(e)})
                    done += 1
                    _progress(job_id, done, total, p.id)

            elif stage == "typeset":
                for p in pages:
                    try:
                        await typeset_mod.typeset_page(p.id, scfg, job_id)
                    except Exception as e:
                        _emit(job_id, {"type": "error", "page": p.id, "error": str(e)})
                    done += 1
                    _progress(job_id, done, total, p.id)

            elif stage == "qc":
                for p in pages:
                    await typeset_mod.render_qc(p.id, scfg, job_id)
                    done += 1
                    _progress(job_id, done, total, p.id)

            _emit(job_id, {"type": "log", "line": f"stage {stage} done"})

        with session() as s:
            ch = s.get(Chapter, chapter_id)
            if all(st in stages for st in ("translate", "clean", "typeset")):
                ch.state = "pages_done"
        _set_state(job_id, state="done", progress=1.0, finished_at=now_iso())
    except QuotaPause as e:
        # edge #17: pause, don't fail; resume is near-free thanks to the cache
        log.warning("job_paused_quota", job=job_id, error=str(e))
        _set_state(job_id, state="queued", error=f"paused: {e}")
    except PermissionError as e:
        _set_state(job_id, state="failed", error=str(e), finished_at=now_iso())
    except Exception as e:
        log.exception("job_failed", job=job_id)
        _set_state(job_id, state="failed", error=str(e), finished_at=now_iso())
    finally:
        _emit(job_id, {"type": "end"})


def _progress(job_id: str, done: int, total: int, page_id: str) -> None:
    with session() as s:
        j = s.get(Job, job_id)
        j.completed = done
        j.total = total
        j.progress = done / max(1, total)
    _emit(job_id, {"type": "progress", "completed": done, "total": total, "page": page_id})


def start_chapter_job(chapter_id: str, stages: list[str], scfg: SeriesConfig) -> str:
    job_id = create_job("chapter_run", chapter_id)
    task = asyncio.create_task(
        run_chapter_stages(job_id, chapter_id, stages, scfg))
    _tasks[job_id] = task
    return job_id


def start_ingest_job(scfg: SeriesConfig) -> str:
    from .pipeline.ingest import ingest_series

    job_id = create_job("ingest", scfg.id)

    async def _run():
        _set_state(job_id, state="running", started_at=now_iso())
        try:
            report = await asyncio.to_thread(
                ingest_series, scfg,
                lambda done, total: _progress(job_id, done, total, ""))
            _emit(job_id, {"type": "log", "line": json.dumps(report)})
            _set_state(job_id, state="done", progress=1.0, finished_at=now_iso())
        except Exception as e:
            log.exception("ingest_failed")
            _set_state(job_id, state="failed", error=str(e), finished_at=now_iso())
        finally:
            _emit(job_id, {"type": "end"})

    _tasks[job_id] = asyncio.create_task(_run())
    return job_id


def start_export_job(scfg: SeriesConfig, options: dict) -> str:
    job_id = create_job("export", scfg.id)

    async def _run():
        _set_state(job_id, state="running", started_at=now_iso())
        try:
            res = await asyncio.to_thread(export_mod.export_series, scfg, options)
            _emit(job_id, {"type": "log", "line": json.dumps(res)})
            state = "done" if res.get("status") == "done" else "failed"
            _set_state(job_id, state=state,
                       error=None if state == "done" else json.dumps(res.get("blockers", [])),
                       finished_at=now_iso())
        except Exception as e:
            _set_state(job_id, state="failed", error=str(e), finished_at=now_iso())
        finally:
            _emit(job_id, {"type": "end"})

    _tasks[job_id] = asyncio.create_task(_run())
    return job_id
