"""Stage 4 — Series Bible construction + lock gate."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
from sqlalchemy.orm import Session

from localiser.ai import vertex
from localiser.db import Chapter, Page, Region, Series, utcnow
from localiser.util import log, read_json, write_json
from localiser.util.paths import bible_dir, page_dir, series_dir


def _prompt(name: str) -> str:
    from localiser.config import get_settings

    return (get_settings().prompts_dir / name).read_text(encoding="utf-8")


def current_bible_path(series_id: str) -> Path | None:
    bdir = bible_dir(series_id)
    cur = bdir / "bible.current"
    if cur.exists() or cur.is_symlink():
        # bible.current may be a real file copy or symlink
        if cur.is_symlink():
            return cur.resolve()
        # if it's a pointer file containing a filename
        text = cur.read_text(encoding="utf-8").strip()
        if text.endswith(".json") and (bdir / text).exists():
            return bdir / text
        # or the current file itself holds the JSON
        try:
            json.loads(cur.read_text(encoding="utf-8")[:20] + "}")
            return cur
        except Exception:
            if (bdir / text).exists():
                return bdir / text
    # fallback latest versioned
    versions = sorted(bdir.glob("bible.v*.json"))
    return versions[-1] if versions else None


def load_bible(series_id: str) -> dict | None:
    p = current_bible_path(series_id)
    if not p or not p.exists():
        return None
    return read_json(p)


def save_bible_draft(series_id: str, bible: dict) -> Path:
    bdir = bible_dir(series_id)
    series = None
    path = bdir / "bible.draft.json"
    write_json(path, bible)
    return path


def lock_bible(db: Session, series_id: str, bible: dict | None = None) -> dict:
    series = db.get(Series, series_id)
    if not series:
        raise ValueError("series not found")
    bdir = bible_dir(series_id)
    if bible is None:
        draft = bdir / "bible.draft.json"
        if draft.exists():
            bible = read_json(draft)
        else:
            bible = load_bible(series_id)
    if not bible:
        raise ValueError("no bible to lock")

    # Validate: every character has register + name_hi
    for c in bible.get("characters", []):
        if not c.get("name_hi") or not c.get("register"):
            raise ValueError(f"Character {c.get('id')} needs name_hi and register before lock")
        c["locked"] = True

    ver = int(series.bible_version or 0) + 1
    bible["version"] = ver
    bible["locked_at"] = datetime.now(timezone.utc).astimezone().isoformat()
    out = bdir / f"bible.v{ver}.json"
    write_json(out, bible)
    # pointer file
    (bdir / "bible.current").write_text(out.name, encoding="utf-8")
    write_json(out, bible)  # ensure
    series.bible_version = ver
    series.bible_locked = 1
    series.updated_at = utcnow()
    db.commit()
    log.info("bible_locked", series_id=series_id, version=ver)
    return bible


async def build_bible_chapter1(
    db: Session,
    series: Series,
    *,
    job_id: str | None = None,
) -> dict:
    ch = (
        db.query(Chapter)
        .filter(Chapter.series_id == series.id)
        .order_by(Chapter.number)
        .first()
    )
    if not ch:
        raise ValueError("no chapters")

    pages = (
        db.query(Page)
        .filter(Page.chapter_id == ch.id, Page.skip_processing == 0)
        .order_by(Page.index_in_ch)
        .all()
    )

    images: list[bytes] = []
    mime: list[str] = []
    # sample up to 40 pages/tiles
    for page in pages[:40]:
        pdir = page_dir(series.id, ch.number, page.index_in_ch)
        img_path = pdir / "original.png"
        if not img_path.exists():
            continue
        bgr = cv2.imread(str(img_path))
        if bgr is None:
            continue
        h, w = bgr.shape[:2]
        # downscale
        scale = min(1.0, 1568 / max(h, w))
        if scale < 1:
            bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)))
        # for very tall, take top portion for bible init sample diversity
        if bgr.shape[0] > 2000:
            bgr = bgr[:2000]
        ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        images.append(buf.tobytes())
        mime.append("image/jpeg")

    schema_hint = {
        "version": 1,
        "series": {
            "title_src": series.title,
            "title_hi": series.title_hi or series.title,
            "logline_hi": "",
            "genre": [],
            "tone": "",
            "world_kind": "",
            "localization_frame": {},
        },
        "characters": [],
        "entities": [],
        "places": [],
        "glossary": [],
        "sfx_map": [],
        "registers": {},
    }
    name_note = (
        "Transliterate names into Devanagari and freeze spelling."
        if series.name_policy == "transliterate"
        else "Indianize names carefully; freeze after lock."
    )
    prompt = (
        _prompt("P-BIBLE-INIT.txt")
        .replace("{name_policy_note}", name_note)
        .replace("{bible_schema}", json.dumps(schema_hint, ensure_ascii=False))
    )

    bible = await vertex.generate(
        purpose="vision_deep",
        prompt=prompt,
        images=images[:40],
        mime_types=mime[:40],
        json_mode=True,
        thinking=True,
        job_id=job_id,
        max_output_tokens=16384,
    )
    if not isinstance(bible, dict):
        raise RuntimeError("bible init did not return JSON object")

    # Ensure series title fields
    bible.setdefault("series", {})
    bible["series"]["title_src"] = series.title
    if series.title_hi:
        bible["series"]["title_hi"] = series.title_hi

    save_bible_draft(series.id, bible)
    ch.state = "bible_synced"
    db.commit()
    return bible


def enforce_locked_diff(locked: dict, proposal: dict) -> dict:
    """Discard any mutation to locked fields — enforce in code, not just prompt."""
    locked_chars = {c["id"]: c for c in locked.get("characters", []) if c.get("locked")}
    locked_gloss = {
        g.get("src"): g for g in locked.get("glossary", []) if g.get("locked")
    }

    safe = {
        "new_characters": [],
        "new_places": proposal.get("new_places", []),
        "new_glossary_terms": [],
        "new_sfx": proposal.get("new_sfx", []),
        "alias_additions": [],
        "matched_existing": proposal.get("matched_existing", []),
        "needs_review": proposal.get("needs_review", []),
        "discarded_mutations": [],
    }
    for c in proposal.get("new_characters", []):
        if c.get("id") in locked_chars:
            safe["discarded_mutations"].append({"type": "character", "id": c.get("id")})
        else:
            safe["new_characters"].append(c)
    for g in proposal.get("new_glossary_terms", []):
        if g.get("src") in locked_gloss:
            safe["discarded_mutations"].append({"type": "glossary", "src": g.get("src")})
        else:
            safe["new_glossary_terms"].append(g)
    for a in proposal.get("alias_additions", []):
        cid = a.get("character_id")
        if cid in locked_chars:
            # aliases may be added
            safe["alias_additions"].append(a)
        else:
            safe["alias_additions"].append(a)
    return safe


async def extend_bible(
    db: Session,
    series: Series,
    chapter: Chapter,
    *,
    job_id: str | None = None,
) -> dict:
    locked = load_bible(series.id)
    if not locked or not series.bible_locked:
        raise RuntimeError("Bible must be locked before extend")

    from localiser.util import compact_bible

    # OCR text dump
    pages = db.query(Page).filter(Page.chapter_id == chapter.id).all()
    lines = []
    for p in pages:
        for r in db.query(Region).filter(Region.page_id == p.id).order_by(Region.ordinal):
            if r.src_text:
                lines.append(f"[{r.kind}] {r.src_text}")

    prompt = (
        _prompt("P-BIBLE-EXTEND.txt")
        .replace("{compacted_bible}", json.dumps(compact_bible(locked), ensure_ascii=False))
        .replace("{n}", str(chapter.number))
    )
    prompt += "\n\nOCR lines:\n" + "\n".join(lines[:400])

    proposal = await vertex.generate(
        purpose="vision_deep",
        prompt=prompt,
        json_mode=True,
        thinking=True,
        job_id=job_id,
    )
    safe = enforce_locked_diff(locked, proposal if isinstance(proposal, dict) else {})
    inbox_path = bible_dir(series.id) / "inbox.json"
    inbox = read_json(inbox_path) if inbox_path.exists() else []
    inbox.append(
        {
            "chapter_id": chapter.id,
            "created_at": utcnow(),
            "proposal": safe,
            "status": "pending",
        }
    )
    write_json(inbox_path, inbox)
    if safe.get("discarded_mutations"):
        log.warning("bible_locked_mutations_discarded", items=safe["discarded_mutations"])
    return safe
