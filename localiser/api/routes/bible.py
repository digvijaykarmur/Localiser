from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from localiser.ai import vertex
from localiser.db import Series, get_db
from localiser.pipeline.bible import (
    bible_dir,
    load_bible,
    lock_bible,
    save_bible_draft,
)
from localiser.schemas import BiblePreviewRequest
from localiser.util import read_json, write_json

router = APIRouter(tags=["bible"])


@router.get("/series/{series_id}/bible")
def get_bible(series_id: str, db: Session = Depends(get_db)):
    s = db.get(Series, series_id)
    if not s:
        raise HTTPException(404, "Series not found")
    draft = bible_dir(series_id) / "bible.draft.json"
    bible = load_bible(series_id)
    if draft.exists():
        draft_data = read_json(draft)
    else:
        draft_data = bible
    return {
        "locked": bool(s.bible_locked),
        "version": s.bible_version,
        "bible": draft_data or bible,
    }


@router.put("/series/{series_id}/bible")
def put_bible(series_id: str, body: dict, db: Session = Depends(get_db)):
    s = db.get(Series, series_id)
    if not s:
        raise HTTPException(404, "Series not found")
    if s.bible_locked:
        # allow draft edits that don't mutate locked fields — store as draft still
        pass
    save_bible_draft(series_id, body)
    return {"ok": True}


@router.post("/series/{series_id}/bible/lock")
def lock(series_id: str, db: Session = Depends(get_db)):
    try:
        bible = lock_bible(db, series_id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, "version": bible.get("version"), "bible": bible}


@router.get("/series/{series_id}/bible/inbox")
def inbox(series_id: str):
    path = bible_dir(series_id) / "inbox.json"
    return read_json(path) if path.exists() else []


@router.post("/series/{series_id}/bible/inbox/{item_idx}/{action}")
def inbox_action(series_id: str, item_idx: int, action: str, db: Session = Depends(get_db)):
    path = bible_dir(series_id) / "inbox.json"
    if not path.exists():
        raise HTTPException(404, "No inbox")
    items = read_json(path)
    if item_idx < 0 or item_idx >= len(items):
        raise HTTPException(404, "Item not found")
    item = items[item_idx]
    if action == "reject":
        item["status"] = "rejected"
    elif action == "accept":
        bible = load_bible(series_id) or {}
        prop = item.get("proposal") or {}
        bible.setdefault("characters", []).extend(prop.get("new_characters") or [])
        bible.setdefault("places", []).extend(prop.get("new_places") or [])
        bible.setdefault("glossary", []).extend(prop.get("new_glossary_terms") or [])
        bible.setdefault("sfx_map", []).extend(prop.get("new_sfx") or [])
        for a in prop.get("alias_additions") or []:
            for c in bible.get("characters", []):
                if c.get("id") == a.get("character_id"):
                    c.setdefault("aliases_hi", []).extend(a.get("aliases_hi") or [])
        save_bible_draft(series_id, bible)
        # re-lock new version
        lock_bible(db, series_id, bible)
        item["status"] = "accepted"
    else:
        raise HTTPException(400, "action must be accept|reject")
    write_json(path, items)
    return {"ok": True, "item": item}


@router.post("/series/{series_id}/bible/preview")
async def preview(series_id: str, body: BiblePreviewRequest, db: Session = Depends(get_db)):
    s = db.get(Series, series_id)
    if not s:
        raise HTTPException(404, "Series not found")
    bible = load_bible(series_id) or {}
    char = next((c for c in bible.get("characters", []) if c.get("id") == body.character_id), None)
    if not char:
        raise HTTPException(404, "Character not found")
    register_id = char.get("register", "urban_hinglish")
    register = (bible.get("registers") or {}).get(register_id, {})
    prompt = (
        f"Localize to Urban Hinglish Devanagari for character {char.get('name_hi')}.\n"
        f"Register {register_id}: {register.get('desc','')}\n"
        f"Rules: {char.get('speech_rules')}\n"
        f"Avoid: {register.get('avoid')}\n"
        f"English sample: {body.sample_text}\n"
        'Output JSON only: {"text":"..."}'
    )
    try:
        data = await vertex.generate(purpose="dialogue", prompt=prompt, json_mode=True)
        text = data.get("text") if isinstance(data, dict) else str(data)
    except Exception as e:
        raise HTTPException(503, f"Vertex unavailable: {e}") from e
    return {"text": text, "character_id": body.character_id, "register": register_id}
