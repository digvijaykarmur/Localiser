"""Stage 9 — Hindi prose story generation (≥2000 words)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import cv2
from sqlalchemy.orm import Session

from localiser.ai import vertex
from localiser.db import Chapter, Page, Region, Series
from localiser.pipeline.bible import load_bible
from localiser.pipeline.translate import _require_bible_locked
from localiser.util import compact_bible, count_words_hi, log, read_json, write_json
from localiser.util.paths import chapter_dir, page_dir, series_dir


def _prompt(name: str) -> str:
    from localiser.config import get_settings

    return (get_settings().prompts_dir / name).read_text(encoding="utf-8")


def _story_cfg(series_id: str) -> dict:
    path = series_dir(series_id) / "series.json"
    cfg = read_json(path) if path.exists() else {}
    return cfg.get("story", {"min_words": 2000, "target_words": 2600, "max_words": 4200})


def rolling_recap(series_id: str, before_number: float, cap: int = 1200) -> str:
    chapters = sorted(
        (series_dir(series_id) / "chapters").glob("ch-*"),
        key=lambda p: p.name,
    )
    parts: list[str] = []
    for ch_path in chapters:
        meta = ch_path / "story.meta.json"
        state = ch_path / "chapter.state.json"
        num = None
        if state.exists():
            num = read_json(state).get("number")
        if num is None or float(num) >= before_number:
            continue
        if meta.exists():
            m = read_json(meta)
            parts.append(m.get("summary_hi") or m.get("recap") or "")
    text = "\n\n".join(p for p in parts if p)
    words = text.split()
    if len(words) > cap:
        # summarize-the-summaries would call model; truncate with note for now
        text = " ".join(words[:cap]) + "\n…"
    return text


async def describe_panels(
    db: Session,
    series: Series,
    page: Page,
    chapter_number: float,
    bible: dict,
    *,
    job_id: str | None = None,
) -> list[dict]:
    pdir = page_dir(series.id, chapter_number, page.index_in_ch)
    bgr = cv2.imread(str(pdir / "original.png"))
    if bgr is None:
        return []
    h, w = bgr.shape[:2]
    tiles = []
    if h > 2000:
        y = 0
        while y < h:
            y2 = min(h, y + 2000)
            tiles.append(bgr[y:y2])
            if y2 >= h:
                break
            y = y2 - 300
    else:
        tiles = [bgr]

    roster = json.dumps(
        [
            {"id": c.get("id"), "name_hi": c.get("name_hi"), "visual_key": (c.get("visual_key") or "")[:120]}
            for c in bible.get("characters", [])
        ],
        ensure_ascii=False,
    )
    prompt = _prompt("P-PANEL.txt").replace("{character_roster}", roster)
    panels: list[dict] = []
    for tile in tiles:
        scale = min(1.0, 1568 / max(tile.shape[0], tile.shape[1]))
        t = tile
        if scale < 1:
            t = cv2.resize(tile, (int(tile.shape[1] * scale), int(tile.shape[0] * scale)))
        ok, buf = cv2.imencode(".jpg", t, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        data = await vertex.generate(
            purpose="vision_bulk",
            prompt=prompt,
            images=[buf.tobytes()],
            mime_types=["image/jpeg"],
            json_mode=True,
            job_id=job_id,
        )
        panels.extend(data.get("panels", []) if isinstance(data, dict) else [])

    analysis_path = pdir / "analysis.json"
    if analysis_path.exists():
        analysis = read_json(analysis_path)
        analysis["panels"] = panels
        write_json(analysis_path, analysis)
    return panels


def _build_beats(db: Session, chapter: Chapter, series_id: str, chapter_number: float) -> str:
    pages = (
        db.query(Page)
        .filter(Page.chapter_id == chapter.id)
        .order_by(Page.index_in_ch)
        .all()
    )
    chunks = []
    for page in pages:
        pdir = page_dir(series_id, chapter_number, page.index_in_ch)
        analysis = read_json(pdir / "analysis.json") if (pdir / "analysis.json").exists() else {}
        regs = (
            db.query(Region)
            .filter(Region.page_id == page.id)
            .order_by(Region.ordinal)
            .all()
        )
        lines = [
            f"- ({r.kind}/{r.speaker_id or '?'}) {r.src_text} ⇒ {r.target_text or ''}"
            for r in regs
            if r.src_text
        ]
        panels = analysis.get("panels", [])
        chunks.append(
            f"## Page {page.index_in_ch}\nPanels: {json.dumps(panels, ensure_ascii=False)[:3000]}\nDialogue:\n"
            + "\n".join(lines)
        )
    return "\n\n".join(chunks)


def _locked_dialogue_lines(db: Session, chapter: Chapter) -> str:
    pages = db.query(Page).filter(Page.chapter_id == chapter.id).all()
    lines = []
    for page in pages:
        for r in db.query(Region).filter(Region.page_id == page.id).order_by(Region.ordinal):
            if r.target_text and r.kind in ("dialogue", "thought", "narration", "ui_window"):
                lines.append(f"- {r.speaker_id or 'narrator'}: 「{r.target_text}」")
    return "\n".join(lines)


def _repetition_ratio(old: str, new: str) -> float:
    def grams(t: str):
        w = t.split()
        return {" ".join(w[i : i + 5]) for i in range(max(0, len(w) - 4))}

    a, b = grams(old), grams(new)
    if not b:
        return 0.0
    return len(a & b) / len(b)


def pick_expansion_targets(story: str, beats: str) -> str:
    scenes = [s.strip() for s in story.split("◆") if s.strip()]
    # crude: shortest scenes
    scenes_sorted = sorted(scenes, key=len)[:3]
    return " | ".join(s[:80].replace("\n", " ") for s in scenes_sorted)


async def generate_story(
    db: Session,
    series: Series,
    chapter: Chapter,
    *,
    job_id: str | None = None,
    hint: str | None = None,
) -> str:
    bible = _require_bible_locked(series)
    scfg = _story_cfg(series.id)
    min_words = int(scfg.get("min_words", 2000))
    target = int(scfg.get("target_words", 2600))
    max_words = int(scfg.get("max_words", 4200))

    pages = (
        db.query(Page)
        .filter(Page.chapter_id == chapter.id, Page.skip_processing == 0)
        .order_by(Page.index_in_ch)
        .all()
    )
    for page in pages:
        await describe_panels(db, series, page, chapter.number, bible, job_id=job_id)

    beats = _build_beats(db, chapter, series.id, chapter.number)
    locked_lines = _locked_dialogue_lines(db, chapter)
    recap = rolling_recap(series.id, chapter.number)

    prompt = (
        _prompt("P-STORY.txt")
        .replace("{compacted_bible}", json.dumps(compact_bible(bible), ensure_ascii=False)[:12000])
        .replace("{rolling_recap}", recap)
        .replace("{beats}", beats[:50000])
        .replace("{min_words}", str(min_words))
        .replace("{target_words}", str(target))
        .replace("{locked_dialogue_lines}", locked_lines[:8000])
        .replace("{n}", str(int(chapter.number) if chapter.number == int(chapter.number) else chapter.number))
    )
    if hint:
        prompt += f"\n\nUser note: {hint}"

    story = await vertex.generate(
        purpose="story",
        prompt=prompt,
        json_mode=False,
        thinking=True,
        job_id=job_id,
        max_output_tokens=16384,
        temperature=0.7,
    )
    if not isinstance(story, str):
        story = json.dumps(story, ensure_ascii=False)

    words = count_words_hi(story)
    attempts = 0
    while words < min_words and attempts < 4:
        deficit = min_words - words
        thin = pick_expansion_targets(story, beats)
        expand_prompt = (
            _prompt("P-STORY-EXPAND.txt")
            .replace("{current}", str(words))
            .replace("{min_words}", str(min_words))
            .replace("{deficit}", str(deficit))
            .replace("{thin_scenes}", thin)
        )
        expand_prompt += "\n\n" + story
        expanded = await vertex.generate(
            purpose="story",
            prompt=expand_prompt,
            json_mode=False,
            thinking=True,
            job_id=job_id,
            max_output_tokens=16384,
            temperature=0.7,
        )
        if not isinstance(expanded, str):
            expanded = str(expanded)
        if _repetition_ratio(story, expanded) > 0.12:
            log.warning("story_expand_rejected_repetition", chapter=chapter.id)
            attempts += 1
            continue
        story = expanded
        words = count_words_hi(story)
        attempts += 1

    if words > max_words:
        compress = await vertex.generate(
            purpose="story",
            prompt=f"इस कथा को {max_words} शब्दों से कम में संक्षिप्त कीजिए, संवाद मत बदलिए।\n\n{story}",
            json_mode=False,
            thinking=True,
            job_id=job_id,
        )
        if isinstance(compress, str):
            story = compress
            words = count_words_hi(story)

    # Story ↔ image dialogue check
    drift = []
    quoted = re.findall(r"「([^」]+)」|\"([^\"]+)\"|'([^']+)'", story)
    flat = [next(g for g in t if g) for t in quoted]
    page_targets = set()
    for page in pages:
        for r in db.query(Region).filter(Region.page_id == page.id):
            if r.target_text:
                page_targets.add(r.target_text.strip())
    for q in flat:
        if q.strip() and q.strip() not in page_targets:
            # soft check — allow minor punctuation diffs
            if not any(q.strip() in t or t in q.strip() for t in page_targets):
                drift.append(q.strip())

    cdir = chapter_dir(series.id, chapter.number)
    (cdir / "story.md").write_text(story, encoding="utf-8")
    meta = {
        "wordcount": words,
        "min_words": min_words,
        "target_words": target,
        "summary_hi": " ".join(story.split()[:180]),
        "drift": drift[:20],
        "short": words < min_words,
    }
    write_json(cdir / "story.meta.json", meta)
    chapter.story_words = words
    if words < min_words:
        chapter.state = "story_short"
    else:
        chapter.state = "story_ready"
    db.commit()
    log.info("story_generated", chapter_id=chapter.id, words=words)
    return story
