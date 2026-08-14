"""FastAPI backend — localhost:8420 (§12.2)."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import structlog
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from . import jobs
from .config import CFG, SeriesConfig, load_json, dump_json, slugify
from .db import (Chapter, Job, LlmCall, Note, PageRow, PatchOp, Region, Series,
                 init_db, now_iso, session)
from .patch import engine as patch_engine
from .pipeline import export as export_mod
from .pipeline.bible import (apply_inbox_item, bible_dir, is_locked, load_bible,
                             save_bible)
from .pipeline.budget import diff_overlay
from .pipeline.paths import chapter_dir_from_id, page_paths
from .ai import vertex

log = structlog.get_logger()

app = FastAPI(title="Localiser — ChitraKatha", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    CFG.ensure_dirs()
    init_db()


def _scfg(series_id: str) -> SeriesConfig:
    try:
        return SeriesConfig.load(CFG.projects_dir, series_id)
    except FileNotFoundError:
        raise HTTPException(404, f"series {series_id} not found")


# --- series -----------------------------------------------------------------

class SeriesIn(BaseModel):
    title: str
    title_hi: str | None = None
    input_path: str
    reading_dir: str = "ltr"
    format: str = "page"
    rights_status: str = "internal_test"


@app.post("/api/series")
async def create_series(body: SeriesIn):
    sid = slugify(body.title)
    scfg = SeriesConfig(id=sid, title=body.title, title_hi=body.title_hi,
                        input_path=body.input_path, reading_dir=body.reading_dir,
                        format=body.format, rights_status=body.rights_status)
    scfg.save(CFG.projects_dir)
    job_id = jobs.start_ingest_job(scfg)
    return {"series_id": sid, "job_id": job_id}


@app.get("/api/series")
def list_series():
    with session() as s:
        rows = s.query(Series).all()
        out = []
        for r in rows:
            chapters = s.query(Chapter).filter(Chapter.series_id == r.id).count()
            pages = (s.query(PageRow).join(Chapter, PageRow.chapter_id == Chapter.id)
                     .filter(Chapter.series_id == r.id).count())
            approved = (s.query(PageRow).join(Chapter, PageRow.chapter_id == Chapter.id)
                        .filter(Chapter.series_id == r.id, PageRow.state == "approved").count())
            first_page = (s.query(PageRow).join(Chapter, PageRow.chapter_id == Chapter.id)
                          .filter(Chapter.series_id == r.id)
                          .order_by(Chapter.number, PageRow.index_in_ch).first())
            out.append({
                "id": r.id, "title": r.title, "title_hi": r.title_hi,
                "chapters": chapters, "pages": pages,
                "percent_complete": round(100 * approved / pages) if pages else 0,
                "bible_locked": bool(r.bible_locked),
                "rights_status": r.rights_status,
                "cover_page_id": first_page.id if first_page else None,
            })
    return out


@app.get("/api/series/{series_id}")
def get_series(series_id: str):
    with session() as s:
        r = s.get(Series, series_id)
        if not r:
            raise HTTPException(404)
        return {"id": r.id, "title": r.title, "title_hi": r.title_hi,
                "reading_dir": r.reading_dir, "format": r.format,
                "bible_locked": bool(r.bible_locked), "bible_version": r.bible_version,
                "rights_status": r.rights_status,
                "config": _scfg(series_id).model_dump()}


# --- bible --------------------------------------------------------------------

@app.get("/api/series/{series_id}/bible")
def get_bible(series_id: str):
    return {"bible": load_bible(series_id), "locked": is_locked(series_id)}


@app.put("/api/series/{series_id}/bible")
def put_bible(series_id: str, body: dict):
    if is_locked(series_id):
        # allow edits but keep the lock; locked names/policy protected by UI + patch ops
        version = save_bible(series_id, body, lock=True)
    else:
        version = save_bible(series_id, body, lock=False)
    return {"version": version}


@app.post("/api/series/{series_id}/bible/lock")
def lock_bible(series_id: str):
    bible = load_bible(series_id)
    missing = [c.get("id") for c in bible.get("characters", [])
               if not c.get("register") or not c.get("name_hi")]
    if missing:
        raise HTTPException(400, f"characters missing register/name_hi: {missing}")
    for c in bible.get("characters", []):
        c["locked"] = True
    version = save_bible(series_id, bible, lock=True)
    return {"locked": True, "version": version}


@app.get("/api/series/{series_id}/bible/inbox")
def bible_inbox(series_id: str):
    return load_json(bible_dir(series_id) / "inbox.json", {"items": []})


@app.post("/api/series/{series_id}/bible/inbox/{item_id}/{action}")
def inbox_action(series_id: str, item_id: str, action: str):
    if action not in ("accept", "reject"):
        raise HTTPException(400)
    apply_inbox_item(series_id, item_id, accept=action == "accept")
    return {"ok": True}


class PreviewIn(BaseModel):
    character_id: str
    sample_text: str


@app.post("/api/series/{series_id}/bible/preview")
async def register_preview(series_id: str, body: PreviewIn):
    scfg = _scfg(series_id)
    bible = load_bible(series_id)
    char = next((c for c in bible.get("characters", []) if c.get("id") == body.character_id), {})
    rid = char.get("register", scfg.register_default)
    reg = (bible.get("registers") or {}).get(rid, {})
    prompt = vertex.load_prompt(
        "p_register_preview",
        speaker_name_hi=char.get("name_hi", "?"), register_id=rid,
        register_desc=reg.get("desc", ""), speech_rules=json.dumps(char.get("speech_rules", []), ensure_ascii=False),
        register_avoid=json.dumps(reg.get("avoid", []), ensure_ascii=False),
        sample_text=body.sample_text)
    data = await vertex.generate(prompt, model=scfg.models["dialogue"], purpose="dialogue")
    return {"hindi": data.get("text", "")}


# --- chapters --------------------------------------------------------------------

@app.get("/api/chapters")
def list_chapters(series_id: str):
    with session() as s:
        rows = (s.query(Chapter).filter(Chapter.series_id == series_id)
                .order_by(Chapter.number).all())
        out = []
        for ch in rows:
            pages = (s.query(PageRow).filter(PageRow.chapter_id == ch.id)
                     .order_by(PageRow.index_in_ch).all())
            out.append({
                "id": ch.id, "number": ch.number, "title_src": ch.title_src,
                "title_hi": ch.title_hi, "state": ch.state,
                "story_words": ch.story_words, "page_count": ch.page_count,
                "page_states": {st: sum(1 for p in pages if p.state == st)
                                for st in {p.state for p in pages}},
            })
    return out


class RunIn(BaseModel):
    stages: list[str]
    confirm_cost: bool = False


@app.post("/api/chapters/{series_id}/{ch}/run")
async def run_chapter(series_id: str, ch: str, body: RunIn):
    chapter_id = f"{series_id}/{ch}"
    scfg = _scfg(series_id)
    estimate = jobs.estimate_cost(chapter_id, body.stages)
    if not body.confirm_cost:
        return {"needs_confirm": True, "estimate": estimate}
    if any(st in body.stages for st in ("translate", "story")) and not is_locked(series_id):
        raise HTTPException(409, "Bible is not locked — lock it in the Bible Editor first")
    job_id = jobs.start_chapter_job(chapter_id, body.stages, scfg)
    return {"job_id": job_id, "estimate": estimate}


@app.get("/api/chapters/{series_id}/{ch}/story")
def get_story(series_id: str, ch: str):
    d = chapter_dir_from_id(f"{series_id}/{ch}")
    story = d / "story.md"
    meta = load_json(d / "story.meta.json", {})
    return {"markdown": story.read_text(encoding="utf-8") if story.exists() else None,
            "meta": meta}


class RegenIn(BaseModel):
    hint: str | None = None


@app.post("/api/chapters/{series_id}/{ch}/story/regen")
async def regen_story(series_id: str, ch: str, body: RegenIn):
    scfg = _scfg(series_id)
    res = await patch_engine.apply_op("REGEN_STORY",
                                      {"chapter_id": f"{series_id}/{ch}", "hint": body.hint},
                                      scfg, source="manual")
    return res


# --- pages -------------------------------------------------------------------------

@app.get("/api/pages/{series_id}/{ch}/{idx}")
def get_page(series_id: str, ch: str, idx: str):
    page_id = f"{series_id}/{ch}/{idx}"
    with session() as s:
        p = s.get(PageRow, page_id)
        if not p:
            raise HTTPException(404)
        regions = (s.query(Region).filter(Region.page_id == page_id)
                   .order_by(Region.ordinal).all())
        return {
            "id": p.id, "state": p.state, "version": p.version,
            "width": p.width, "height": p.height, "flagged": bool(p.flagged),
            "regions": [{
                "id": r.id, "ordinal": r.ordinal, "kind": r.kind,
                "bbox": json.loads(r.bbox), "polygon": json.loads(r.polygon) if r.polygon else None,
                "src_text": r.src_text, "src_script": r.src_script,
                "target_text": r.target_text, "target_locked": bool(r.target_locked),
                "speaker_id": r.speaker_id, "speaker_conf": r.speaker_conf,
                "clean_tier": r.clean_tier, "clean_risk": r.clean_risk,
                "status": r.status, "confidence": r.confidence, "source": r.source,
                "render": json.loads(r.render_json) if r.render_json else None,
            } for r in regions],
        }


@app.get("/api/pages/{series_id}/{ch}/{idx}/image/{which}")
def page_image(series_id: str, ch: str, idx: str, which: str):
    pp = page_paths(f"{series_id}/{ch}/{idx}")
    if which == "diff":
        if not pp["composite"].exists():
            raise HTTPException(404)
        img = diff_overlay(pp["dir"])
        tmp = pp["dir"] / "diff.png"
        img.save(tmp)
        return FileResponse(tmp, media_type="image/png")
    name_map = {"original": pp["original"], "cleaned": pp["clean_layer"],
                "composite": pp["composite"], "budget": pp["budget"]}
    f = name_map.get(which)
    if which == "cleaned":
        # cleaned view = original + clean layer
        from PIL import Image as PILImage

        if not pp["clean_layer"].exists():
            f = pp["original"]
        else:
            base = PILImage.open(pp["original"]).convert("RGBA")
            layer = PILImage.open(pp["clean_layer"]).convert("RGBA")
            base.alpha_composite(layer)
            tmp = pp["dir"] / "cleaned_view.png"
            base.save(tmp)
            f = tmp
    if not f or not f.exists():
        f = pp["original"]
        if not f.exists():
            raise HTTPException(404)
    return FileResponse(f, media_type="image/png")


class RegionPatch(BaseModel):
    target_text: str | None = None
    locked: bool | None = None
    speaker_id: str | None = None
    font_px: int | None = None


@app.patch("/api/regions/{series_id}/{ch}/{idx}/{rid}")
async def patch_region(series_id: str, ch: str, idx: str, rid: str, body: RegionPatch):
    region_id = f"{series_id}/{ch}/{idx}/{rid}"
    scfg = _scfg(series_id)
    results = []
    if body.target_text is not None:
        results.append(await patch_engine.apply_op(
            "SET_LINE", {"region_id": region_id, "text": body.target_text}, scfg, source="manual"))
    if body.speaker_id is not None:
        results.append(await patch_engine.apply_op(
            "SET_SPEAKER", {"region_id": region_id, "character_id": body.speaker_id}, scfg, source="manual"))
    if body.font_px is not None:
        results.append(await patch_engine.apply_op(
            "FONT_SIZE", {"region_ids": [region_id], "absolute_px": body.font_px}, scfg, source="manual"))
    if body.locked is not None:
        with session() as s:
            s.get(Region, region_id).target_locked = 1 if body.locked else 0
    return {"applied": results}


@app.post("/api/regions/{series_id}/{ch}/{idx}/{rid}/retranslate")
async def retranslate_region(series_id: str, ch: str, idx: str, rid: str, body: RegenIn):
    region_id = f"{series_id}/{ch}/{idx}/{rid}"
    scfg = _scfg(series_id)
    return await patch_engine.apply_op(
        "RETRANSLATE", {"region_ids": [region_id], "hint": body.hint}, scfg, source="manual")


class RecleanIn(BaseModel):
    tier: int | None = None


@app.post("/api/regions/{series_id}/{ch}/{idx}/{rid}/reclean")
async def reclean_region(series_id: str, ch: str, idx: str, rid: str, body: RecleanIn):
    region_id = f"{series_id}/{ch}/{idx}/{rid}"
    scfg = _scfg(series_id)
    return await patch_engine.apply_op(
        "RECLEAN", {"region_ids": [region_id], "tier": body.tier}, scfg, source="manual")


@app.post("/api/pages/{series_id}/{ch}/{idx}/rebuild")
async def rebuild_page(series_id: str, ch: str, idx: str):
    from .pipeline.clean import composite_page

    page_id = f"{series_id}/{ch}/{idx}"
    await asyncio.to_thread(composite_page, page_id)
    return {"ok": True}


@app.post("/api/pages/{series_id}/{ch}/{idx}/approve")
async def approve_page(series_id: str, ch: str, idx: str):
    scfg = _scfg(series_id)
    return await patch_engine.apply_op(
        "APPROVE", {"scope": "page", "scope_id": f"{series_id}/{ch}/{idx}"}, scfg, source="manual")


# --- notes -----------------------------------------------------------------------

@app.get("/api/notes")
def list_notes(page_id: str):
    with session() as s:
        rows = s.query(Note).filter(Note.page_id == page_id).all()
        return [{"id": n.id, "page_id": n.page_id, "region_id": n.region_id,
                 "x": n.x, "y": n.y, "body": n.body, "status": n.status} for n in rows]


class NoteIn(BaseModel):
    page_id: str
    region_id: str | None = None
    x: float
    y: float
    body: str


@app.post("/api/notes")
def create_note(body: NoteIn):
    import uuid as _uuid

    nid = _uuid.uuid4().hex
    with session() as s:
        s.add(Note(id=nid, page_id=body.page_id, region_id=body.region_id,
                   x=body.x, y=body.y, body=body.body))
    return {"id": nid}


@app.post("/api/notes/{note_id}/apply")
async def apply_note(note_id: str):
    with session() as s:
        n = s.get(Note, note_id)
        if not n:
            raise HTTPException(404)
        page_id, region_id, text = n.page_id, n.region_id, n.body
    series_id = page_id.split("/")[0]
    scfg = _scfg(series_id)
    proposal = await patch_engine.propose_ops("page", page_id, text, region_id, scfg)
    results = []
    for op in proposal.get("ops", []):
        if op.get("op") == "ASK" or op.get("needs_confirm"):
            continue
        results.append(await patch_engine.apply_op(op["op"], op.get("args", {}),
                                                   scfg, source="note", source_ref=note_id))
    with session() as s:
        n = s.get(Note, note_id)
        n.status = "applied"
        n.resolved_at = now_iso()
    return {"proposal": proposal, "applied": results}


@app.post("/api/notes/{note_id}/{action}")
def note_action(note_id: str, action: str):
    if action not in ("reject", "resolve"):
        raise HTTPException(400)
    with session() as s:
        n = s.get(Note, note_id)
        n.status = "rejected" if action == "reject" else "applied"
        n.resolved_at = now_iso()
    return {"ok": True}


# --- chat + ops --------------------------------------------------------------------

class ChatIn(BaseModel):
    scope: str
    scope_id: str
    message: str
    selected_region: str | None = None


@app.post("/api/chat")
async def chat(body: ChatIn):
    series_id = body.scope_id.split("/")[0]
    scfg = _scfg(series_id)
    return await patch_engine.propose_ops(body.scope, body.scope_id, body.message,
                                          body.selected_region, scfg)


class OpsIn(BaseModel):
    series_id: str
    ops: list[dict]


@app.post("/api/ops/apply")
async def apply_ops(body: OpsIn):
    scfg = _scfg(body.series_id)
    results = []
    for op in body.ops:
        results.append(await patch_engine.apply_op(op["op"], op.get("args", {}), scfg))
    return {"applied": results}


@app.post("/api/ops/{op_id}/revert")
async def revert(op_id: str, series_id: str):
    scfg = _scfg(series_id)
    return await patch_engine.revert_op(op_id, scfg)


# --- jobs / SSE -----------------------------------------------------------------------

@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    with session() as s:
        j = s.get(Job, job_id)
        if not j:
            raise HTTPException(404)
        return {"id": j.id, "kind": j.kind, "state": j.state, "progress": j.progress,
                "completed": j.completed, "total": j.total, "error": j.error}


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str):
    q = jobs.subscribe(job_id)

    async def gen():
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=30)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") == "end":
                break

    return StreamingResponse(gen(), media_type="text/event-stream")


# --- export + cost -----------------------------------------------------------------------

class ExportIn(BaseModel):
    series_id: str
    options: dict = {}


@app.post("/api/export")
def export(body: ExportIn):
    scfg = _scfg(body.series_id)
    blockers = export_mod.export_blockers(body.series_id)
    if blockers and not body.options.get("override_blockers"):
        return {"status": "blocked", "blockers": blockers}
    job_id = jobs.start_export_job(scfg, body.options)
    return {"status": "started", "job_id": job_id}


@app.get("/api/export/blockers")
def get_blockers(series_id: str):
    return {"blockers": export_mod.export_blockers(series_id)}


@app.get("/api/cost")
def cost(series_id: str | None = None):
    pricing = load_json(CFG.assets_dir / "pricing.json", {})
    with session() as s:
        calls = s.query(LlmCall).all()
    total_in = sum(c.in_tokens or 0 for c in calls)
    total_out = sum(c.out_tokens or 0 for c in calls)
    total_think = sum(c.thinking_tokens or 0 for c in calls)
    by_model: dict[str, dict] = {}
    est = 0.0
    for c in calls:
        m = by_model.setdefault(c.model or "?", {"calls": 0, "in": 0, "out": 0, "cache_hits": 0})
        m["calls"] += 1
        m["in"] += c.in_tokens or 0
        m["out"] += (c.out_tokens or 0) + (c.thinking_tokens or 0)
        m["cache_hits"] += c.cache_hit or 0
        p = pricing.get(c.model or "", {})
        est += (c.in_tokens or 0) / 1e6 * p.get("in_per_mtok", 0)
        est += ((c.out_tokens or 0) + (c.thinking_tokens or 0)) / 1e6 * p.get("out_per_mtok", 0)
    return {"calls": len(calls), "in_tokens": total_in, "out_tokens": total_out,
            "thinking_tokens": total_think, "by_model": by_model,
            "estimated_usd": round(est, 4)}
