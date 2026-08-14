"""Patch engine — chat/notes → structured ops → apply + invalidate."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from localiser.ai import vertex
from localiser.db import Chapter, Note, Page, PatchOp, Region, Series, utcnow
from localiser.pipeline.bible import load_bible
from localiser.pipeline.clean import compose_page
from localiser.pipeline.consistency import TranslationMemory, apply_glossary, load_glossary, save_glossary
from localiser.pipeline.typeset import typeset_page
from localiser.util import new_id
from localiser.util.paths import chapter_dir


def _prompt(name: str) -> str:
    from localiser.config import get_settings

    return (get_settings().prompts_dir / name).read_text(encoding="utf-8")


async def parse_chat_intent(
    *,
    scope: str,
    scope_id: str,
    message: str,
    selected_region_id: str | None,
    db: Session,
) -> dict:
    regions_info = []
    characters = []
    bible = None
    series_id = scope_id.split("/")[0] if "/" in scope_id else scope_id
    if scope == "page":
        regs = db.query(Region).filter(Region.page_id == scope_id).order_by(Region.ordinal).all()
        regions_info = [
            {
                "id": r.id,
                "speaker": r.speaker_id,
                "src_text": r.src_text,
                "target_text": r.target_text,
            }
            for r in regs
        ]
        page = db.get(Page, scope_id)
        if page:
            series_id = page.chapter_id.split("/")[0]
    bible = load_bible(series_id)
    if bible:
        characters = [
            {"id": c.get("id"), "name_hi": c.get("name_hi")} for c in bible.get("characters", [])
        ]

    prompt = (
        _prompt("P-CHAT-INTENT.txt")
        .replace("{page_id or chapter_id or series_id}", scope_id)
        .replace("{region_id or none}", selected_region_id or "none")
        .replace("{[{id, speaker, src_text, target_text}]}", json.dumps(regions_info, ensure_ascii=False))
        .replace("{roster}", json.dumps(characters, ensure_ascii=False))
    )
    prompt += f"\n\nUser message:\n{message}"
    data = await vertex.generate(purpose="review", prompt=prompt, json_mode=True, thinking=True)
    return data if isinstance(data, dict) else {"ops": [], "raw": data}


def apply_ops(db: Session, ops: list[dict], *, source: str = "chat", source_ref: str | None = None) -> list[PatchOp]:
    applied: list[PatchOp] = []
    for item in ops:
        op_name = item.get("op")
        args = item.get("args") or {}
        before: dict[str, Any] = {}
        scope = "region"
        scope_id = args.get("region_id") or args.get("scope_id") or ""

        if op_name == "SET_LINE":
            reg = db.get(Region, args["region_id"])
            if not reg:
                continue
            before = {"target_text": reg.target_text}
            reg.target_text = args.get("text", "")
            reg.target_locked = 1
            reg.status = "translated"
            scope_id = reg.id
            # TM lock
            page = db.get(Page, reg.page_id)
            series_id = page.chapter_id.split("/")[0] if page else ""
            if series_id and reg.src_text:
                TranslationMemory(series_id).store(
                    reg.src_text,
                    reg.target_text,
                    reg.speaker_id,
                    reg.kind,
                    "user",
                    reg.id,
                    user_locked=1,
                )
            _rebuild_page(db, reg.page_id)

        elif op_name == "SET_SPEAKER":
            reg = db.get(Region, args["region_id"])
            if not reg:
                continue
            before = {"speaker_id": reg.speaker_id}
            reg.speaker_id = args.get("character_id")
            scope_id = reg.id

        elif op_name == "FONT_SIZE":
            for rid in args.get("region_ids") or [args.get("region_id")]:
                if not rid:
                    continue
                reg = db.get(Region, rid)
                if not reg:
                    continue
                render = json.loads(reg.render_json or "{}")
                before = {"render_json": reg.render_json}
                if "absolute_px" in args:
                    render["size"] = args["absolute_px"]
                else:
                    delta = float(args.get("delta_pct") or 0)
                    render["size"] = int(render.get("size", 18) * (1 + delta / 100))
                reg.render_json = json.dumps(render)
                _rebuild_page(db, reg.page_id)
                scope_id = rid

        elif op_name == "SKIP_REGION":
            reg = db.get(Region, args["region_id"])
            if not reg:
                continue
            before = {"status": reg.status, "clean_tier": reg.clean_tier}
            reg.status = "approved"
            reg.clean_tier = 0
            reg.target_text = reg.src_text
            scope_id = reg.id

        elif op_name == "GLOSSARY_SET":
            series_id = args.get("series_id") or scope_id
            gloss = load_glossary(series_id)
            before = {"glossary": gloss}
            src, hi = args.get("src"), args.get("hi")
            found = False
            for g in gloss:
                if g.get("src") == src:
                    if g.get("hi") and g["hi"] != hi:
                        g.setdefault("known_wrong_hi", []).append(g["hi"])
                    g["hi"] = hi
                    g["locked"] = True
                    found = True
            if not found:
                gloss.append({"src": src, "hi": hi, "locked": True})
            save_glossary(series_id, gloss)
            # deterministic substitution across unlocked regions
            regions = (
                db.query(Region)
                .join(Page, Region.page_id == Page.id)
                .join(Chapter, Page.chapter_id == Chapter.id)
                .filter(Chapter.series_id == series_id, Region.target_locked == 0)
                .all()
            )
            for reg in regions:
                if reg.target_text:
                    new = apply_glossary(reg.target_text, [{"src": src, "hi": hi}])
                    # also replace old hi if present in known_wrong path — already in apply
                    if new != reg.target_text:
                        reg.target_text = new
            scope = "series"
            scope_id = series_id

        elif op_name == "RENAME":
            series_id = args.get("series_id") or (scope_id.split("/")[0] if scope_id else "")
            bible = load_bible(series_id) or {}
            cid = args.get("character_id")
            new_name = args.get("name_hi")
            old = None
            for c in bible.get("characters", []):
                if c.get("id") == cid:
                    old = c.get("name_hi")
                    c["name_hi"] = new_name
            before = {"old_name_hi": old, "character_id": cid}
            if old and new_name:
                from localiser.pipeline.bible import bible_dir
                from localiser.util import write_json
                from localiser.db import Series as SeriesModel

                # write draft update — user should re-lock for permanence; still apply text pass
                path = bible_dir(series_id) / "bible.draft.json"
                write_json(path, bible)
                regs = (
                    db.query(Region)
                    .join(Page, Region.page_id == Page.id)
                    .join(Chapter, Page.chapter_id == Chapter.id)
                    .filter(Chapter.series_id == series_id)
                    .all()
                )
                for reg in regs:
                    if reg.target_text and old in reg.target_text:
                        reg.target_text = reg.target_text.replace(old, new_name)
            scope = "series"
            scope_id = series_id

        elif op_name == "APPROVE":
            sc = args.get("scope") or scope
            sid = args.get("scope_id") or scope_id
            if sc == "page":
                page = db.get(Page, sid)
                if page:
                    page.state = "approved"
                    before = {"state": "composited"}
            elif sc == "region":
                reg = db.get(Region, sid)
                if reg:
                    before = {"status": reg.status}
                    reg.status = "approved"
                    reg.target_locked = 1
            scope = sc
            scope_id = sid

        elif op_name == "REVERT":
            # handled separately via revert_op
            continue

        elif op_name == "ASK":
            continue

        else:
            # store unhandled for audit
            pass

        row = PatchOp(
            id=new_id(),
            scope=scope,
            scope_id=scope_id,
            op=op_name or "UNKNOWN",
            payload=json.dumps({"args": args, "before": before}, ensure_ascii=False),
            source=source,
            source_ref=source_ref,
            applied_at=utcnow(),
        )
        db.add(row)
        applied.append(row)

    db.commit()
    return applied


def _rebuild_page(db: Session, page_id: str) -> None:
    page = db.get(Page, page_id)
    if not page:
        return
    chapter = db.get(Chapter, page.chapter_id)
    if not chapter:
        return
    series_id = chapter.series_id
    # sync typeset + compose — run async from caller ideally; sync fallback pillow path
    import asyncio

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # schedule
            asyncio.create_task(
                _async_rebuild(db, page, series_id, chapter.number)
            )
        else:
            loop.run_until_complete(_async_rebuild(db, page, series_id, chapter.number))
    except RuntimeError:
        asyncio.run(_async_rebuild(page_id=page.id, series_id=series_id, chapter_number=chapter.number))


async def _async_rebuild(db_or_page=None, page=None, series_id=None, chapter_number=None, **kwargs):
    from localiser.db import get_session_factory

    if kwargs.get("page_id"):
        Session = get_session_factory()
        with Session() as db:
            page = db.get(Page, kwargs["page_id"])
            await typeset_page(db, page, series_id=kwargs["series_id"], chapter_number=kwargs["chapter_number"])
            compose_page(db, page, series_id=kwargs["series_id"], chapter_number=kwargs["chapter_number"])
        return
    await typeset_page(db_or_page, page, series_id=series_id, chapter_number=chapter_number)
    compose_page(db_or_page, page, series_id=series_id, chapter_number=chapter_number)


def revert_op(db: Session, op_id: str) -> None:
    op = db.get(PatchOp, op_id)
    if not op or op.reverted_at:
        return
    payload = json.loads(op.payload)
    before = payload.get("before") or {}
    args = payload.get("args") or {}
    if op.op == "SET_LINE":
        reg = db.get(Region, op.scope_id)
        if reg and "target_text" in before:
            reg.target_text = before["target_text"]
            _rebuild_page(db, reg.page_id)
    elif op.op == "SET_SPEAKER":
        reg = db.get(Region, op.scope_id)
        if reg:
            reg.speaker_id = before.get("speaker_id")
    op.reverted_at = utcnow()
    db.commit()


def apply_note(db: Session, note_id: str) -> list[PatchOp]:
    note = db.get(Note, note_id)
    if not note:
        raise ValueError("note not found")
    # Convert note body via chat intent synchronously scheduled by API
    note.status = "applied"
    note.resolved_at = utcnow()
    db.commit()
    return []
