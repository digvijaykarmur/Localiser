"""Stage 3 — Utterance grouping & speaker attribution (§5 Stage 3)."""
from __future__ import annotations

import json
import math
import uuid

import structlog
from PIL import Image

from ..ai import vertex
from ..config import SeriesConfig, load_json, dump_json
from ..db import Region, session
from .bible import load_bible, compact_roster
from .paths import page_paths

log = structlog.get_logger()


# --- grouping ---------------------------------------------------------------

def _overlap_1d(a0: float, a1: float, b0: float, b1: float) -> float:
    inter = max(0.0, min(a1, b1) - max(a0, b0))
    denom = min(a1 - a0, b1 - b0)
    return inter / denom if denom > 0 else 0.0


def group_utterances(regions: list[Region]) -> None:
    """Assign shared utterance_id to connected dialogue/thought bubbles."""
    ordered = sorted(regions, key=lambda r: r.ordinal)
    for r in ordered:
        if not r.utterance_id:
            r.utterance_id = uuid.uuid4().hex[:12]
    for a, b in zip(ordered, ordered[1:]):
        if a.kind != b.kind or a.kind not in ("dialogue", "thought"):
            continue
        ax, ay, aw, ah = json.loads(a.bbox)
        bx, by, bw, bh = json.loads(b.bbox)
        # gap between bboxes < 0.4 * min height
        gap_y = max(0, max(ay, by) - min(ay + ah, by + bh))
        gap_x = max(0, max(ax, bx) - min(ax + aw, bx + bw))
        gap = math.hypot(gap_x, gap_y)
        if gap >= 0.4 * min(ah, bh):
            continue
        h_ov = _overlap_1d(ax, ax + aw, bx, bx + bw)
        v_ov = _overlap_1d(ay, ay + ah, by, by + bh)
        if h_ov > 0.35 or v_ov > 0.35:
            b.utterance_id = a.utterance_id


# --- speaker attribution ------------------------------------------------------

def tail_speaker(region_meta: dict, characters: list[dict]) -> tuple[str | None, float]:
    """Signal 1: bubble-tail geometry → ray cast to a character box."""
    poly = region_meta.get("polygon")
    if not poly or len(poly) < 4 or not characters:
        return None, 0.0
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    tail = max(poly, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
    dx, dy = tail[0] - cx, tail[1] - cy
    norm = math.hypot(dx, dy) or 1.0
    radius = max(math.hypot(*(p[0] - cx, p[1] - cy)) for p in poly)
    # sample the ray out to 1.5 x bubble radius
    for t in (1.0, 1.2, 1.5):
        px, py = tail[0] + dx / norm * radius * (t - 1.0) * 2, tail[1] + dy / norm * radius * (t - 1.0) * 2
        for ch in characters:
            x0, y0, x1, y1 = ch["px"]
            if x0 <= px <= x1 and y0 <= py <= y1:
                return ch.get("id") or ch.get("descriptor"), 0.8
    return None, 0.0


async def attribute_speakers(page_id: str, scfg: SeriesConfig, job_id: str | None = None) -> None:
    pp = page_paths(page_id)
    analysis = load_json(pp["analysis"], {})
    characters = analysis.get("characters", [])
    bible = load_bible(scfg.id)
    roster = compact_roster(bible)
    img = Image.open(pp["original"]).convert("RGB")

    with session() as s:
        regions = (s.query(Region).filter(Region.page_id == page_id)
                   .order_by(Region.ordinal).all())
        group_utterances(regions)

        dialog = [r for r in regions if r.kind in ("dialogue", "thought", "shout")
                  and r.status not in ("approved",)]
        prev_speaker: str | None = None
        recent: list[str] = []

        for r in dialog:
            meta = next((m for m in analysis["regions"] if m["id"] == r.id), {})
            sp1, conf1 = tail_speaker(meta, characters)

            sp2, conf2 = None, 0.0
            if roster and (conf1 < 0.8 or sp1 is None):
                bbox = json.loads(r.bbox)
                x, y, w, h = bbox
                m = int(max(w, h) * 1.2)
                panel = img.crop((max(0, x - m), max(0, y - m),
                                  min(img.width, x + w + m), min(img.height, y + h + m)))
                prompt = vertex.load_prompt(
                    "p_speaker",
                    character_roster_with_visual_keys=json.dumps(roster, ensure_ascii=False),
                    previous_speaker=prev_speaker or "none",
                    bubble_text=r.src_text or "",
                )
                try:
                    data = await vertex.generate(
                        prompt, model=scfg.models["vision_bulk"], purpose="speaker",
                        images=[panel], job_id=job_id,
                    )
                    sp2 = data.get("speaker_id")
                    conf2 = float(data.get("confidence") or 0.0)
                    if sp2 == "unknown":
                        sp2 = None
                except Exception as e:
                    log.warning("speaker_call_failed", region=r.id, error=str(e))

            # continuity prior: alternation in a two-character conversation
            speaker, conf = (sp2, conf2) if conf2 >= conf1 else (sp1, conf1)
            if sp1 and sp2 and sp1 != sp2 and len(set(recent[-4:])) == 2:
                expected = next((s0 for s0 in set(recent[-4:]) if s0 != prev_speaker), None)
                if expected in (sp1, sp2):
                    speaker, conf = expected, 0.6

            if conf < 0.55 or not speaker:
                r.speaker_id = None
                r.speaker_conf = conf
                log.info("speaker_unknown", region=r.id)
            else:
                r.speaker_id = speaker
                r.speaker_conf = conf
                prev_speaker = speaker
                recent.append(speaker)

    # mirror to analysis.json
    with session() as s:
        rows = s.query(Region).filter(Region.page_id == page_id).all()
    by_id = {r.id: r for r in rows}
    for meta in analysis.get("regions", []):
        r = by_id.get(meta["id"])
        if r:
            meta["speaker_id"] = r.speaker_id
            meta["speaker_conf"] = r.speaker_conf
            meta["utterance_id"] = r.utterance_id
    dump_json(pp["analysis"], analysis)
