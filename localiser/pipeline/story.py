"""Stage — Hindi prose story, ≥2000 words (§9). Requires locked Bible."""
from __future__ import annotations

import json
import re

import structlog
from PIL import Image

from ..ai import vertex
from ..config import SeriesConfig, dump_json, load_json
from ..db import Chapter, PageRow, Region, session
from ..util import count_words_hi, ngram_overlap
from .bible import compact_bible, compact_roster, load_bible, require_locked
from .paths import chapter_dir_from_id, page_paths

log = structlog.get_logger()

RECAP_CAP_WORDS = 1200


# --- §9.2 panel description pass ------------------------------------------------

async def panel_pass(page_id: str, scfg: SeriesConfig, job_id: str | None = None) -> list[dict]:
    pp = page_paths(page_id)
    analysis = load_json(pp["analysis"], {})
    if analysis.get("panels"):
        return analysis["panels"]  # cached
    bible = load_bible(scfg.id)
    img = Image.open(pp["original"]).convert("RGB")
    prompt = vertex.load_prompt(
        "p_panel", character_roster=json.dumps(compact_roster(bible), ensure_ascii=False))

    panels: list[dict] = []
    H = img.height
    tile_h, overlap = 2000, 300
    y = 0
    while y < H:
        y2 = min(y + tile_h, H)
        tile = img.crop((0, y, img.width, y2))
        data = await vertex.generate(prompt, model=scfg.models["vision_bulk"],
                                     purpose="panel", images=[tile], job_id=job_id)
        panels += data.get("panels", [])
        if y2 >= H:
            break
        y = y2 - overlap
    analysis["panels"] = panels
    dump_json(pp["analysis"], analysis)
    return panels


# --- beats assembly ------------------------------------------------------------

def build_beats(chapter_id: str) -> tuple[str, list[str]]:
    """Per-page structured beats + the locked dialogue lines (from TM/typeset)."""
    beats_lines: list[str] = []
    locked_dialogue: list[str] = []
    with session() as s:
        pages = (s.query(PageRow).filter(PageRow.chapter_id == chapter_id)
                 .order_by(PageRow.index_in_ch).all())
        for p in pages:
            analysis = load_json(page_paths(p.id)["analysis"], {})
            beats_lines.append(f"--- Page {p.index_in_ch} ---")
            for panel in analysis.get("panels", []):
                beats_lines.append("PANEL: " + json.dumps(panel, ensure_ascii=False))
            regions = (s.query(Region).filter(Region.page_id == p.id)
                       .order_by(Region.ordinal).all())
            for r in regions:
                if not (r.src_text or "").strip():
                    continue
                hi = (r.target_text or "").strip()
                beats_lines.append(
                    f"[{r.kind}] {r.speaker_id or 'अज्ञात'}: src=\"{r.src_text}\""
                    + (f" hi=\"{hi}\"" if hi else ""))
                if hi and r.kind in ("dialogue", "thought", "shout"):
                    locked_dialogue.append(f"{r.speaker_id or 'अज्ञात'}: {hi}")
    return "\n".join(beats_lines), locked_dialogue


def rolling_recap(series_id: str, before_number: float) -> str:
    """Concatenated summaries of previous chapters, capped at 1200 words."""
    parts: list[str] = []
    with session() as s:
        chapters = (s.query(Chapter).filter(Chapter.series_id == series_id,
                                            Chapter.number < before_number)
                    .order_by(Chapter.number).all())
    for ch in chapters:
        meta = load_json(chapter_dir_from_id(ch.id) / "story.meta.json", {})
        if meta.get("recap"):
            parts.append(f"अध्याय {ch.number:g}: {meta['recap']}")
    recap = "\n".join(parts)
    words = recap.split()
    if len(words) > RECAP_CAP_WORDS:
        recap = " ".join(words[-RECAP_CAP_WORDS:])
    return recap or "(पहला अध्याय)"


def pick_expansion_targets(story: str, beats: str) -> str:
    """Thinnest scenes by (panel mentions ÷ prose words) — named explicitly."""
    scenes = [sc.strip() for sc in story.split("◆") if sc.strip()]
    if not scenes:
        return "पूरा चैप्टर"
    ranked = sorted(scenes, key=lambda sc: len(sc.split()))
    thin = ranked[: max(1, len(ranked) // 3)]
    return "\n".join(f"- दृश्य जो इस पंक्ति से शुरू होता है: \"{sc[:80]}...\"" for sc in thin)


# --- §9.3/9.4 generation with word-count loop -------------------------------------

async def generate_story(chapter_id: str, scfg: SeriesConfig, job_id: str | None = None,
                         hint: str | None = None) -> dict:
    require_locked(scfg.id)
    bible = load_bible(scfg.id)

    with session() as s:
        ch = s.get(Chapter, chapter_id)
        pages = (s.query(PageRow).filter(PageRow.chapter_id == chapter_id)
                 .order_by(PageRow.index_in_ch).all())

    for p in pages:
        if not p.skip_processing:
            await panel_pass(p.id, scfg, job_id)

    beats, locked_dialogue = build_beats(chapter_id)
    recap = rolling_recap(scfg.id, ch.number)
    n = f"{ch.number:g}"

    prompt = vertex.load_prompt(
        "p_story",
        compacted_bible=json.dumps(compact_bible(bible), ensure_ascii=False),
        rolling_recap=recap, beats=beats,
        min_words=scfg.story.min_words, target_words=scfg.story.target_words,
        locked_dialogue_lines="\n".join(locked_dialogue) or "(इस चैप्टर में संवाद नहीं)",
        n=n,
    )
    if hint:
        prompt += f"\n\nUser का निर्देश: {hint}"

    story = await vertex.generate(prompt, model=scfg.models["story"], purpose="story",
                                  json_response=False, job_id=job_id, timeout_s=300)
    story = story.strip()

    # NN-8: word-count loop, max 4 expansion attempts, anti-padding check
    words = count_words_hi(story)
    attempts = 0
    while words < scfg.story.min_words and attempts < 4:
        deficit = scfg.story.min_words - words
        expand_prompt = vertex.load_prompt(
            "p_story_expand", current=words, min_words=scfg.story.min_words,
            deficit=deficit, story=story,
            thin_scenes=pick_expansion_targets(story, beats))
        expanded = await vertex.generate(expand_prompt, model=scfg.models["story"],
                                         purpose="story", json_response=False,
                                         job_id=job_id, timeout_s=300, use_cache=False)
        expanded = expanded.strip()
        new_words = count_words_hi(expanded)
        added = expanded.replace(story[:200], "")
        if new_words > words and ngram_overlap(story, added) <= 0.12:
            story, words = expanded, new_words
        elif new_words > words:
            log.warning("expansion_rejected_repetition", chapter=chapter_id)
        attempts += 1

    status = "ok"
    if words < scfg.story.min_words:
        status = "story_short"
        log.warning("story_short", chapter=chapter_id, words=words)

    # hard cap: one compression pass
    if words > scfg.story.max_words:
        comp_prompt = (f"यह चैप्टर {words} शब्दों का है, अधिकतम {scfg.story.max_words} "
                       f"होने चाहिए। घटनाएँ और संवाद वही रखते हुए संक्षिप्त कीजिए। "
                       f"पूरा चैप्टर Markdown में लौटाइए।\n\n{story}")
        story = (await vertex.generate(comp_prompt, model=scfg.models["story"],
                                       purpose="story", json_response=False,
                                       job_id=job_id, timeout_s=300)).strip()
        words = count_words_hi(story)

    drift = check_story_dialogue_drift(story, locked_dialogue)

    ch_dir = chapter_dir_from_id(chapter_id)
    ch_dir.mkdir(parents=True, exist_ok=True)
    (ch_dir / "story.md").write_text(story, encoding="utf-8")

    recap_line = " ".join(story.replace("#", "").split()[:120])
    dump_json(ch_dir / "story.meta.json", {
        "wordcount": words, "status": status, "recap": recap_line,
        "drift": drift, "beats_pages": len(pages),
    })
    with session() as s:
        row = s.get(Chapter, chapter_id)
        row.story_words = words
        if row.state in ("bible_synced", "analyzed", "new"):
            row.state = "story_ready"
    return {"words": words, "status": status, "drift": drift}


# --- §9.5 story ↔ image consistency ------------------------------------------------

def check_story_dialogue_drift(story: str, locked_dialogue: list[str]) -> list[dict]:
    """Extract quoted dialogue from the story; flag lines that never appear."""
    drift = []
    quoted = re.findall(r"[\"“]([^\"”]{4,})[\"”]", story)
    normalized_story_quotes = [q.strip() for q in quoted]
    for line in locked_dialogue:
        hi = line.split(":", 1)[-1].strip()
        if len(hi) < 4:
            continue
        found = hi in story or any(hi in q or q in hi for q in normalized_story_quotes)
        if not found:
            drift.append({"line": line, "issue": "story_dialogue_drift"})
    return drift
