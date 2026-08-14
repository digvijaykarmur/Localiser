"""Patch Engine — chat/notes → structured ops → minimal rebuild (§13).

Every op stores a `before` snapshot for revert. Invalidation rules follow the
table in §13.1: RENAME and GLOSSARY_SET are deterministic substitutions, never
model runs.
"""
from __future__ import annotations

import json
import uuid

import structlog

from ..config import CFG, SeriesConfig
from ..db import Chapter, Note, PageRow, PatchOp, Region, now_iso, session
from ..pipeline import clean as clean_mod
from ..pipeline import translate as translate_mod
from ..pipeline import typeset as typeset_mod
from ..pipeline.bible import is_locked, load_bible, save_bible
from ..pipeline.consistency import TM, enforce_glossary, learn_wrong_variant
from ..ai import vertex

log = structlog.get_logger()

SERIES_WIDE_OPS = {"RENAME", "GLOSSARY_SET", "SET_REGISTER", "SFX_SET"}


def blast_radius(op: str, args: dict, series_id: str) -> str:
    with session() as s:
        if op == "GLOSSARY_SET":
            n = (s.query(Region)
                 .filter(Region.target_text.contains(args.get("src", "\u0000"))).count())
            n2 = (s.query(Region)
                  .filter(Region.target_text.contains(args.get("hi", "\u0000"))).count())
            return f"~{max(n, n2)} regions across the series"
        if op == "RENAME":
            n = s.query(Region).filter(Region.target_text.isnot(None)).count()
            return f"name post-pass over {n} translated regions + all stories"
        if op == "SET_REGISTER":
            n = (s.query(Region)
                 .filter(Region.speaker_id == args.get("character_id"),
                         Region.target_locked == 0).count())
            return f"{n} unlocked regions for this character, series-wide"
    return "single region"


async def propose_ops(scope: str, scope_id: str, message: str,
                      selected_region: str | None, scfg: SeriesConfig) -> dict:
    """chat message → P-CHAT-INTENT → op cards (never applied silently)."""
    with session() as s:
        visible = []
        if scope == "page":
            for r in (s.query(Region).filter(Region.page_id == scope_id)
                      .order_by(Region.ordinal).all()):
                visible.append({"id": r.id, "speaker": r.speaker_id,
                                "src_text": r.src_text, "target_text": r.target_text})
    bible = load_bible(scfg.id)
    roster = [{"id": c.get("id"), "name_hi": c.get("name_hi")}
              for c in bible.get("characters", [])]
    prompt = vertex.load_prompt(
        "p_chat_intent", scope_id=f"{scope}:{scope_id}",
        selected_region=selected_region or "none",
        visible_regions=json.dumps(visible, ensure_ascii=False),
        roster=json.dumps(roster, ensure_ascii=False), message=message)
    data = await vertex.generate(prompt, model=scfg.models["review"], purpose="review",
                                 use_cache=False)
    for op in data.get("ops", []):
        if op.get("op") in SERIES_WIDE_OPS:
            op["needs_confirm"] = True
            op["blast_radius"] = blast_radius(op["op"], op.get("args", {}), scfg.id)
    return data


# --- apply -----------------------------------------------------------------------


async def apply_op(op: str, args: dict, scfg: SeriesConfig,
                   source: str = "chat", source_ref: str | None = None) -> dict:
    """Apply one op in a transaction, record patch_ops row, run minimal rebuild."""
    op_id = uuid.uuid4().hex
    before = _snapshot_before(op, args)
    result: dict = {"op": op, "op_id": op_id}

    if op == "SET_LINE":
        rid, text = args["region_id"], args["text"]
        with session() as s:
            r = s.get(Region, rid)
            old = r.target_text
            r.target_text = text
            r.target_locked = 1
            r.status = "translated"
            page_id, speaker, kind = r.page_id, r.speaker_id, r.kind
            src = r.src_text
        tm = TM(scfg.id)
        try:
            tm.store(src or "", speaker, kind, scfg.register_default, text,
                     rid, user_locked=True)
            result["tm_occurrences"] = tm.occurrences(src or "")
        finally:
            tm.close()
        # glossary self-heal: user replaced a term → learn the wrong variant
        bible = load_bible(scfg.id)
        if old:
            for term in bible.get("glossary", []):
                if term.get("hi") and term["hi"] in text and term["hi"] not in (old or ""):
                    learn_wrong_variant(bible.get("glossary", []), term["src"], old)
        await typeset_mod.typeset_page(page_id, scfg, only_region_ids=[rid])

    elif op == "RETRANSLATE":
        rids = args.get("region_ids", [])
        pages = _pages_of(rids)
        for page_id in pages:
            await translate_mod.translate_page(page_id, scfg, hint=args.get("hint"),
                                               only_region_ids=rids)
            await typeset_mod.typeset_page(page_id, scfg, only_region_ids=rids)

    elif op in ("FONT_SIZE", "FONT_FAMILY"):
        rids = args.get("region_ids", [])
        with session() as s:
            for rid in rids:
                r = s.get(Region, rid)
                render = json.loads(r.render_json or "{}")
                if op == "FONT_SIZE":
                    if args.get("absolute_px"):
                        render["size"] = int(args["absolute_px"])
                    else:
                        render["size"] = int(render.get("size", 16) *
                                             (1 + args.get("delta_pct", 0) / 100))
                else:
                    render["font_role"] = args.get("role", "dialogue")
                r.render_json = json.dumps(render)
        for page_id in _pages_of(rids):
            await typeset_mod.typeset_page(page_id, scfg, only_region_ids=rids)

    elif op == "SET_SPEAKER":
        rid = args["region_id"]
        with session() as s:
            r = s.get(Region, rid)
            r.speaker_id = args["character_id"]
            r.speaker_conf = 1.0
            page_id = r.page_id
        await translate_mod.translate_page(page_id, scfg, only_region_ids=[rid])
        await typeset_mod.typeset_page(page_id, scfg, only_region_ids=[rid])

    elif op == "SET_REGISTER":
        bible = load_bible(scfg.id)
        for c in bible.get("characters", []):
            if c.get("id") == args["character_id"]:
                if args.get("register_id"):
                    c["register"] = args["register_id"]
                for rule in args.get("rules_delta", []) or []:
                    c.setdefault("speech_rules", []).append(rule)
        save_bible(scfg.id, bible, lock=is_locked(scfg.id))
        with session() as s:
            rows = (s.query(Region)
                    .filter(Region.speaker_id == args["character_id"],
                            Region.target_locked == 0).all())
            affected = {}
            for r in rows:
                affected.setdefault(r.page_id, []).append(r.id)
        for page_id, rids in affected.items():
            await translate_mod.translate_page(page_id, scfg, only_region_ids=rids)
            await typeset_mod.typeset_page(page_id, scfg, only_region_ids=rids)
        result["regions_updated"] = sum(len(v) for v in affected.values())

    elif op == "RENAME":
        # deterministic post-pass — seconds, no model calls (§13.1)
        bible = load_bible(scfg.id)
        old_hi = None
        for c in bible.get("characters", []):
            if c.get("id") == args["character_id"]:
                old_hi = c.get("name_hi")
                c["name_hi"] = args["name_hi"]
        save_bible(scfg.id, bible, lock=is_locked(scfg.id))
        n = 0
        if old_hi:
            with session() as s:
                rows = (s.query(Region)
                        .filter(Region.target_text.contains(old_hi)).all())
                affected = {}
                for r in rows:
                    r.target_text = r.target_text.replace(old_hi, args["name_hi"])
                    affected.setdefault(r.page_id, []).append(r.id)
                    n += 1
            for page_id, rids in affected.items():
                await typeset_mod.typeset_page(page_id, scfg, only_region_ids=rids)
            _rename_in_stories(scfg.id, old_hi, args["name_hi"])
        result["regions_updated"] = n

    elif op == "GLOSSARY_SET":
        bible = load_bible(scfg.id)
        gl = bible.setdefault("glossary", [])
        entry = next((t for t in gl if t.get("src", "").lower() == args["src"].lower()), None)
        old_hi = entry.get("hi") if entry else None
        if entry:
            if old_hi and old_hi != args["hi"]:
                learn_wrong_variant(gl, args["src"], old_hi)
            entry["hi"] = args["hi"]
        else:
            gl.append({"src": args["src"], "hi": args["hi"]})
        save_bible(scfg.id, bible, lock=is_locked(scfg.id))
        n = 0
        with session() as s:
            q = s.query(Region).filter(Region.target_text.isnot(None))
            affected = {}
            for r in q.all():
                new = enforce_glossary(r.target_text, gl)
                if old_hi and old_hi in r.target_text:
                    new = new.replace(old_hi, args["hi"])
                if new != r.target_text:
                    r.target_text = new
                    affected.setdefault(r.page_id, []).append(r.id)
                    n += 1
        for page_id, rids in affected.items():
            await typeset_mod.typeset_page(page_id, scfg, only_region_ids=rids)
        result["regions_updated"] = n

    elif op == "SFX_SET":
        bible = load_bible(scfg.id)
        bible.setdefault("sfx_map", []).append({"src": args["src"], "hi": args["hi"]})
        save_bible(scfg.id, bible, lock=is_locked(scfg.id))

    elif op == "RECLEAN":
        rids = args.get("region_ids", [])
        for page_id in _pages_of(rids):
            clean_mod.clean_page(page_id, scfg, only_region_ids=rids)

    elif op == "SKIP_REGION":
        rid = args["region_id"]
        with session() as s:
            r = s.get(Region, rid)
            r.status = "skipped"
            page_id = r.page_id
        # rebuild budget + composite without this region (edge #24)
        clean_mod.clean_page(page_id, scfg)
        await typeset_mod.typeset_page(page_id, scfg)

    elif op == "APPROVE":
        with session() as s:
            if args.get("scope") == "page":
                p = s.get(PageRow, args["scope_id"])
                p.state = "approved"
                for r in s.query(Region).filter(Region.page_id == p.id).all():
                    if r.status != "skipped":
                        r.status = "approved"
            elif args.get("scope") == "chapter":
                s.get(Chapter, args["scope_id"]).state = "approved"

    elif op == "REVERT":
        return await revert_op(args.get("op_id") or args.get("scope_id"), scfg)

    elif op == "REGEN_STORY":
        from ..pipeline.story import generate_story

        result.update(await generate_story(args["chapter_id"], scfg, hint=args.get("hint")))

    else:
        raise ValueError(f"unknown op {op}")

    with session() as s:
        s.add(PatchOp(
            id=op_id, scope=_scope_of(op, args), scope_id=_scope_id_of(op, args),
            op=op, payload=json.dumps({"args": args, "before": before}, ensure_ascii=False),
            source=source, source_ref=source_ref, applied_at=now_iso()))
    return result


def _pages_of(region_ids: list[str]) -> list[str]:
    return sorted({rid.rsplit("/", 1)[0] for rid in region_ids})


def _scope_of(op: str, args: dict) -> str:
    if op in SERIES_WIDE_OPS:
        return "series"
    if "region_id" in args or "region_ids" in args:
        return "region"
    if "chapter_id" in args:
        return "chapter"
    return args.get("scope", "page")


def _scope_id_of(op: str, args: dict) -> str:
    return (args.get("region_id") or ",".join(args.get("region_ids", []))
            or args.get("chapter_id") or args.get("scope_id") or args.get("character_id", ""))


def _snapshot_before(op: str, args: dict) -> dict:
    before: dict = {}
    rids = ([args["region_id"]] if args.get("region_id") else args.get("region_ids", []))
    if rids:
        with session() as s:
            for rid in rids:
                r = s.get(Region, rid)
                if r:
                    before[rid] = {
                        "target_text": r.target_text, "target_locked": r.target_locked,
                        "speaker_id": r.speaker_id, "status": r.status,
                        "render_json": r.render_json, "clean_tier": r.clean_tier,
                    }
    return before


def _rename_in_stories(series_id: str, old: str, new: str) -> None:
    with session() as s:
        chapters = s.query(Chapter).filter(Chapter.series_id == series_id).all()
    from ..pipeline.paths import chapter_dir_from_id

    for ch in chapters:
        p = chapter_dir_from_id(ch.id) / "story.md"
        if p.exists():
            t = p.read_text(encoding="utf-8")
            if old in t:
                p.write_text(t.replace(old, new), encoding="utf-8")


async def revert_op(op_id: str, scfg: SeriesConfig) -> dict:
    with session() as s:
        row = s.get(PatchOp, op_id)
        if not row:
            raise KeyError(op_id)
        payload = json.loads(row.payload)
        before = payload.get("before", {})
        pages = set()
        for rid, snap in before.items():
            r = s.get(Region, rid)
            if r:
                for k, v in snap.items():
                    setattr(r, k, v)
                pages.add(r.page_id)
        row.reverted_at = now_iso()
    for page_id in pages:
        await typeset_mod.typeset_page(page_id, scfg,
                                       only_region_ids=list(before.keys()))
    return {"reverted": op_id, "pages_rebuilt": len(pages)}
