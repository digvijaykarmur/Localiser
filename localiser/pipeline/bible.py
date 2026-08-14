"""Stage 4 — Series Bible: build, lock, incremental extension, re-identification (§5.4, §6.1)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import structlog
from PIL import Image

from ..ai import vertex
from ..config import CFG, SeriesConfig, dump_json, load_json
from ..db import Chapter, PageRow, Region, Series, session
from .paths import bible_dir, page_paths

log = structlog.get_logger()

BIBLE_SCHEMA_HINT = json.dumps({
    "series": {
        "title_src": "...", "title_hi": "...", "logline_hi": "...",
        "genre": ["..."], "tone": "...", "world_kind": "...",
        "localization_frame": {
            "region_analogue": "...", "architecture": "...", "currency": "...",
            "food": ["..."], "honorifics": {}, "swap_rules": [{"src": "...", "hi": "...", "why": "..."}],
            "do_not_localize": ["character names", "place names", "series title"],
        },
    },
    "characters": [{
        "id": "char_x", "name_src": "...", "name_hi": "...", "aliases_hi": [],
        "role": "...", "visual_key": "...", "age_band": "...",
        "register": "...", "speech_rules": [], "catchphrases_hi": [],
        "forbidden": [], "locked": True,
    }],
    "entities": [], "places": [], "glossary": [{"src": "...", "hi": "...", "locked": True}],
    "sfx_map": [{"src": "...", "hi": "..."}],
    "registers": {"urban_hinglish_high": {"desc": "...", "rules": [], "avoid": []}},
}, ensure_ascii=False)


# --- storage ---------------------------------------------------------------

def bible_current_path(series_id: str) -> Path | None:
    d = bible_dir(series_id)
    cur = d / "bible.current"
    if cur.exists():
        target = cur.read_text().strip()
        p = d / target
        return p if p.exists() else None
    return None


def load_bible(series_id: str) -> dict:
    p = bible_current_path(series_id)
    return load_json(p, {}) if p else {}


def save_bible(series_id: str, bible: dict, lock: bool = False) -> int:
    d = bible_dir(series_id)
    d.mkdir(parents=True, exist_ok=True)
    with session() as s:
        row = s.get(Series, series_id)
        version = (row.bible_version or 0) + 1
        row.bible_version = version
        if lock:
            row.bible_locked = 1
            bible["locked_at"] = __import__("datetime").datetime.now().astimezone().isoformat()
    bible["version"] = version
    fname = f"bible.v{version}.json"
    dump_json(d / fname, bible)
    (d / "bible.current").write_text(fname, encoding="utf-8")
    return version


def is_locked(series_id: str) -> bool:
    with session() as s:
        row = s.get(Series, series_id)
        return bool(row and row.bible_locked)


def require_locked(series_id: str) -> None:
    """The approval gate (§4.4): translate/story refuse to run while unlocked."""
    if not is_locked(series_id):
        raise PermissionError(
            f"Bible for '{series_id}' is not locked. Lock the Bible in the Bible "
            f"Editor before running translation or story stages."
        )


def compact_bible(bible: dict, chapter_chars: set[str] | None = None) -> dict:
    """§6.1 compaction: strip refs, long descs, absent characters."""
    out = json.loads(json.dumps(bible, ensure_ascii=False))
    out.pop("version", None)
    for c in out.get("characters", []):
        c.pop("refs", None)
        for k, v in list(c.items()):
            if isinstance(v, str) and k.startswith("desc") and len(v) > 200:
                c[k] = v[:200]
    if chapter_chars:
        out["characters"] = [c for c in out.get("characters", [])
                             if c.get("id") in chapter_chars]
    return out


def compact_roster(bible: dict) -> list[dict]:
    return [{"id": c.get("id"), "name_hi": c.get("name_hi"),
             "visual_key": c.get("visual_key"), "register": c.get("register")}
            for c in bible.get("characters", [])]


# --- Stage 4.1: first build ---------------------------------------------------

async def build_bible(scfg: SeriesConfig, job_id: str | None = None) -> dict:
    with session() as s:
        ch = (s.query(Chapter).filter(Chapter.series_id == scfg.id)
              .order_by(Chapter.number).first())
        if not ch:
            raise RuntimeError("no chapters ingested")
        pages = (s.query(PageRow).filter(PageRow.chapter_id == ch.id)
                 .order_by(PageRow.index_in_ch).all())
        regions = []
        for p in pages:
            regions += (s.query(Region).filter(Region.page_id == p.id)
                        .order_by(Region.ordinal).all())

    chapter_text = "\n".join(
        f"[p{r.page_id.split('/')[-1]}/{r.ordinal:02d}] ({r.kind}) {r.src_text}"
        for r in regions if r.src_text
    )

    images = []
    for p in pages[:40]:
        pp = page_paths(p.id)
        if pp["original"].exists():
            images.append(Image.open(pp["original"]).convert("RGB"))
    name_policy_note = (
        "" if scfg.name_policy == "transliterate"
        else "Exception: name_policy=indianize — propose Indian names, once, here."
    )
    prompt = vertex.load_prompt(
        "p_bible_init", title=scfg.title, chapter_text=chapter_text or "(no text found)",
        name_policy_note=name_policy_note, bible_schema=BIBLE_SCHEMA_HINT,
    )
    # chunk into 2 calls if too many images
    if len(images) > 20:
        images = images[::2][:20]
    bible = await vertex.generate(
        prompt, model=scfg.models["vision_deep"], purpose="vision_deep",
        images=images, job_id=job_id, timeout_s=300,
    )
    save_reference_crops(scfg.id, bible, pages)
    save_bible(scfg.id, bible, lock=False)
    return bible


def save_reference_crops(series_id: str, bible: dict, pages) -> None:
    """Save face crops per character into bible/refs/<char_id>/ using the
    character boxes recorded during detection."""
    refs_root = bible_dir(series_id) / "refs"
    for p in pages:
        pp = page_paths(p.id)
        analysis = load_json(pp["analysis"], {})
        chars = analysis.get("characters", [])
        if not chars or not pp["original"].exists():
            continue
        img = Image.open(pp["original"]).convert("RGB")
        for i, cbox in enumerate(chars[:6]):
            x0, y0, x1, y1 = [int(v) for v in cbox.get("px", [0, 0, 0, 0])]
            if x1 - x0 < 24 or y1 - y0 < 24:
                continue
            crop = img.crop((x0, y0, x1, y1))
            cid = cbox.get("id") or "unassigned"
            d = refs_root / cid
            d.mkdir(parents=True, exist_ok=True)
            crop.save(d / f"{p.id.replace('/', '_')}_c{i}.png")


# --- Stage 4.3: incremental extension -----------------------------------------

LOCKED_MUTABLE_DENY = {"id", "name_src", "name_hi", "register", "visual_key"}


async def extend_bible(scfg: SeriesConfig, chapter_id: str, job_id: str | None = None) -> dict:
    bible = load_bible(scfg.id)
    if not bible:
        raise RuntimeError("no bible to extend — build it on chapter 1 first")

    with session() as s:
        pages = (s.query(PageRow).filter(PageRow.chapter_id == chapter_id)
                 .order_by(PageRow.index_in_ch).all())
        regions = []
        for p in pages:
            regions += s.query(Region).filter(Region.page_id == p.id).all()
    chapter_text = "\n".join(f"({r.kind}) {r.src_text}" for r in regions if r.src_text)
    n = chapter_id.rsplit("-", 1)[-1]

    prompt = vertex.load_prompt(
        "p_bible_extend",
        compacted_bible=json.dumps(compact_bible(bible), ensure_ascii=False),
        n=n, chapter_text=chapter_text,
    )
    proposal = await vertex.generate(
        prompt, model=scfg.models["vision_deep"], purpose="vision_deep", job_id=job_id,
    )
    proposal = enforce_no_locked_mutation(bible, proposal)

    inbox_path = bible_dir(scfg.id) / "inbox.json"
    inbox = load_json(inbox_path, {"items": []})
    for key in ("new_characters", "new_places", "new_glossary_terms", "new_sfx", "alias_additions"):
        for item in proposal.get(key, []) or []:
            inbox["items"].append({
                "id": f"{key}-{len(inbox['items'])}", "kind": key,
                "chapter_id": chapter_id, "payload": item, "status": "pending",
            })
    dump_json(inbox_path, inbox)
    return proposal


def enforce_no_locked_mutation(bible: dict, proposal: dict) -> dict:
    """§4.3 rule 3 — enforced in code, not just the prompt."""
    locked_ids = {c.get("id") for c in bible.get("characters", []) if c.get("locked")}
    locked_terms = {g.get("src", "").lower() for g in bible.get("glossary", []) if g.get("locked")}
    clean = dict(proposal)
    kept = []
    for c in proposal.get("new_characters", []) or []:
        if c.get("id") in locked_ids:
            log.warning("discarded_locked_character_mutation", id=c.get("id"))
            continue
        kept.append(c)
    clean["new_characters"] = kept
    kept_terms = []
    for g in proposal.get("new_glossary_terms", []) or []:
        if (g.get("src") or "").lower() in locked_terms:
            log.warning("discarded_locked_glossary_mutation", src=g.get("src"))
            continue
        kept_terms.append(g)
    clean["new_glossary_terms"] = kept_terms
    return clean


def apply_inbox_item(series_id: str, item_id: str, accept: bool) -> None:
    inbox_path = bible_dir(series_id) / "inbox.json"
    inbox = load_json(inbox_path, {"items": []})
    item = next((i for i in inbox["items"] if i["id"] == item_id), None)
    if not item:
        raise KeyError(item_id)
    item["status"] = "accepted" if accept else "rejected"
    if accept:
        bible = load_bible(series_id)
        kind, payload = item["kind"], item["payload"]
        if kind == "new_characters":
            bible.setdefault("characters", []).append(payload)
        elif kind == "new_places":
            bible.setdefault("places", []).append(payload)
        elif kind == "new_glossary_terms":
            bible.setdefault("glossary", []).append(payload)
        elif kind == "new_sfx":
            bible.setdefault("sfx_map", []).append(payload)
        elif kind == "alias_additions":
            for c in bible.get("characters", []):
                if c.get("id") == payload.get("character_id"):
                    c.setdefault("aliases_hi", []).append(payload.get("alias"))
        save_bible(series_id, bible, lock=is_locked(series_id))
    dump_json(inbox_path, inbox)


# --- Stage 4.4: re-identification across chapters ------------------------------

def _dhash(img: Image.Image, size: int = 32) -> np.ndarray:
    g = np.asarray(img.convert("L").resize((size + 1, size), Image.LANCZOS), dtype=np.int16)
    return (g[:, 1:] > g[:, :-1]).flatten()


def _hair_hist(img: Image.Image) -> np.ndarray:
    """HSV histogram of the top third of the face box, 8 bins x 3 channels."""
    hsv = np.asarray(img.convert("HSV"))
    top = hsv[: max(1, hsv.shape[0] // 3)]
    hist = []
    for ch in range(3):
        h, _ = np.histogram(top[..., ch], bins=8, range=(0, 255))
        hist.append(h / max(1, h.sum()))
    return np.concatenate(hist)


def face_descriptor(img: Image.Image) -> dict:
    return {"dhash": _dhash(img).tolist(), "hair": _hair_hist(img).tolist()}


def descriptor_score(a: dict, b: dict) -> float:
    da, db = np.array(a["dhash"], bool), np.array(b["dhash"], bool)
    hamming = float(np.count_nonzero(da != db)) / len(da) * 64.0
    ha, hb = np.array(a["hair"]), np.array(b["hair"])
    hist_inter = float(np.minimum(ha, hb).sum()) / 3.0
    return 0.5 * (1 - hamming / 64.0) + 0.5 * hist_inter


async def match_character(series_id: str, candidate: Image.Image,
                          scfg: SeriesConfig, job_id: str | None = None) -> tuple[str | None, float]:
    """Cheap descriptor match; grey zone escalates to Gemini P-IDMATCH."""
    cand = face_descriptor(candidate)
    best_id, best_score, best_ref = None, 0.0, None
    refs_root = bible_dir(series_id) / "refs"
    if refs_root.exists():
        for char_dir in refs_root.iterdir():
            if not char_dir.is_dir():
                continue
            for ref_file in list(char_dir.glob("*.png"))[:4]:
                ref_img = Image.open(ref_file)
                score = descriptor_score(cand, face_descriptor(ref_img))
                if score > best_score:
                    best_id, best_score, best_ref = char_dir.name, score, ref_img
    if best_score > 0.72:
        return best_id, best_score
    if 0.55 <= best_score <= 0.72 and best_ref is not None:
        bible = load_bible(series_id)
        char = next((c for c in bible.get("characters", []) if c.get("id") == best_id), {})
        prompt = vertex.load_prompt("p_idmatch", character_name=char.get("name_hi", best_id),
                                    visual_key=char.get("visual_key", ""))
        data = await vertex.generate(prompt, model=scfg.models["vision_bulk"],
                                     purpose="idmatch", images=[best_ref, candidate],
                                     job_id=job_id)
        if data.get("same"):
            return best_id, float(data.get("confidence", 0.7))
    return None, best_score
