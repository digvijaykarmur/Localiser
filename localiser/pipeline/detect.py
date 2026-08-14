"""Stage 1B/1C — Gemini detection + reconciliation with CV."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from sqlalchemy.orm import Session

from localiser.ai import vertex
from localiser.db import Page, Region
from localiser.pipeline.detect_cv import (
    BubbleCandidate,
    detect_bubbles_cv,
    glyph_mask_from_bbox,
    iou_box,
)
from localiser.util import log, new_id, read_json, write_json
from localiser.util.paths import page_dir

TILE_H = 2000
TILE_OVERLAP = 300
MAX_DIM = 1568


def _load_prompt(name: str) -> str:
    from localiser.config import get_settings

    path = get_settings().prompts_dir / name
    return path.read_text(encoding="utf-8")


def _encode_tile(bgr: np.ndarray) -> bytes:
    h, w = bgr.shape[:2]
    scale = min(1.0, MAX_DIM / max(h, w))
    if scale < 1.0:
        bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise RuntimeError("encode failed")
    return buf.tobytes(), scale


def _norm_box_to_xywh(box: list[int], tw: int, th: int, scale: float, y_off: int) -> tuple[int, int, int, int]:
    """Normalized 0-1000 box → page pixel x,y,w,h."""
    x0, y0, x1, y1 = box
    px0 = int(x0 / 1000 * tw / scale)
    py0 = int(y0 / 1000 * th / scale) + y_off
    px1 = int(x1 / 1000 * tw / scale)
    py1 = int(y1 / 1000 * th / scale) + y_off
    return px0, py0, max(1, px1 - px0), max(1, py1 - py0)


async def detect_page_gemini(
    bgr: np.ndarray,
    *,
    reading_dir: str,
    job_id: str | None = None,
) -> dict:
    prompt_tmpl = _load_prompt("P-DETECT.txt")
    prompt = prompt_tmpl.replace("{reading_dir}", reading_dir)
    h, w = bgr.shape[:2]

    # Tile long strips
    tiles: list[tuple[int, np.ndarray]] = []
    if h > TILE_H + TILE_OVERLAP:
        y = 0
        while y < h:
            y2 = min(h, y + TILE_H)
            tiles.append((y, bgr[y:y2]))
            if y2 >= h:
                break
            y = y2 - TILE_OVERLAP
    else:
        tiles = [(0, bgr)]

    all_regions: list[dict] = []
    all_chars: list[dict] = []

    for y_off, tile in tiles:
        th, tw = tile.shape[:2]
        blob, scale = _encode_tile(tile)
        data = await vertex.generate(
            purpose="vision_bulk",
            prompt=prompt,
            images=[blob],
            mime_types=["image/jpeg"],
            json_mode=True,
            thinking=False,
            job_id=job_id,
        )
        for r in data.get("text_regions", []):
            box = r.get("box") or r.get("bbox")
            if not box or len(box) != 4:
                continue
            x, y, bw, bh = _norm_box_to_xywh(box, tw, th, scale, y_off)
            # Clip to page
            x = max(0, min(x, w - 1))
            y = max(0, min(y, h - 1))
            bw = max(1, min(bw, w - x))
            bh = max(1, min(bh, h - y))
            all_regions.append(
                {
                    "kind": r.get("kind", "dialogue"),
                    "bbox": [x, y, bw, bh],
                    "order": r.get("order", 0),
                    "script_guess": r.get("script_guess"),
                    "speaker_hint": r.get("speaker_hint"),
                    "connected_to": r.get("connected_to"),
                }
            )
        for c in data.get("characters", []):
            box = c.get("box") or c.get("bbox")
            if not box:
                continue
            x, y, bw, bh = _norm_box_to_xywh(box, tw, th, scale, y_off)
            all_chars.append({"bbox": [x, y, bw, bh], "desc": c.get("desc") or c.get("visual")})

    # NMS merge across tiles
    merged = _nms_regions(all_regions, iou_thresh=0.5)
    return {"text_regions": merged, "characters": all_chars}


def _nms_regions(regions: list[dict], iou_thresh: float = 0.5) -> list[dict]:
    if not regions:
        return []
    regions = sorted(regions, key=lambda r: r.get("order", 0))
    keep: list[dict] = []
    for r in regions:
        rb = tuple(r["bbox"])
        matched = False
        for k in keep:
            kb = tuple(k["bbox"])
            if iou_box(rb, kb) >= iou_thresh:  # type: ignore[arg-type]
                # union
                x1 = min(rb[0], kb[0])
                y1 = min(rb[1], kb[1])
                x2 = max(rb[0] + rb[2], kb[0] + kb[2])
                y2 = max(rb[1] + rb[3], kb[1] + kb[3])
                k["bbox"] = [x1, y1, x2 - x1, y2 - y1]
                matched = True
                break
        if not matched:
            keep.append(r)
    return keep


def reconcile(
    cv_cands: list[BubbleCandidate],
    gemini_regions: list[dict],
    gray: np.ndarray,
) -> list[dict]:
    used_cv: set[int] = set()
    out: list[dict] = []

    for g in gemini_regions:
        gb = tuple(g["bbox"])
        best_i, best_iou = -1, 0.0
        for i, c in enumerate(cv_cands):
            if i in used_cv:
                continue
            score = iou_box(gb, c.bbox)  # type: ignore[arg-type]
            if score > best_iou:
                best_iou, best_i = score, i
        if best_i >= 0 and best_iou >= 0.4:
            used_cv.add(best_i)
            c = cv_cands[best_i]
            out.append(
                {
                    "kind": g.get("kind", "dialogue"),
                    "bbox": list(c.bbox),
                    "polygon": c.polygon,
                    "glyph_mask": c.glyph_mask,
                    "interior_color": list(c.interior_color),
                    "source": "both",
                    "confidence": 0.95,
                    "order": g.get("order", 0),
                    "speaker_hint": g.get("speaker_hint"),
                }
            )
        else:
            mask = glyph_mask_from_bbox(gray, gb)  # type: ignore[arg-type]
            out.append(
                {
                    "kind": g.get("kind", "dialogue"),
                    "bbox": list(gb),
                    "polygon": None,
                    "glyph_mask": mask,
                    "interior_color": [252, 252, 250],
                    "source": "gemini_only",
                    "confidence": 0.65,
                    "order": g.get("order", 0),
                    "speaker_hint": g.get("speaker_hint"),
                }
            )

    for i, c in enumerate(cv_cands):
        if i in used_cv:
            continue
        out.append(
            {
                "kind": "unknown",
                "bbox": list(c.bbox),
                "polygon": c.polygon,
                "glyph_mask": c.glyph_mask,
                "interior_color": list(c.interior_color),
                "source": "cv_only",
                "confidence": 0.50,
                "order": 9999 + i,
                "speaker_hint": None,
            }
        )
    return out


def sort_reading_order(regions: list[dict], reading_dir: str) -> list[dict]:
    def key(r: dict):
        x, y, w, h = r["bbox"]
        cy, cx = y + h / 2, x + w / 2
        return (cy, -cx if reading_dir == "rtl" else cx)

    regions = sorted(regions, key=key)
    # Tie-break within horizontal bands using model order when present
    heights = [r["bbox"][3] for r in regions] or [40]
    band = 0.6 * float(np.median(heights))
    # stable sort already by y; refine within bands by order field
    refined: list[dict] = []
    i = 0
    while i < len(regions):
        j = i + 1
        yi = regions[i]["bbox"][1] + regions[i]["bbox"][3] / 2
        while j < len(regions):
            yj = regions[j]["bbox"][1] + regions[j]["bbox"][3] / 2
            if abs(yj - yi) > band:
                break
            j += 1
        band_slice = sorted(regions[i:j], key=lambda r: r.get("order", 0) or 0)
        if reading_dir == "rtl":
            band_slice = sorted(
                band_slice,
                key=lambda r: (
                    r.get("order", 0) or 0,
                    -(r["bbox"][0] + r["bbox"][2] / 2),
                ),
            )
        refined.extend(band_slice)
        i = j
    for idx, r in enumerate(refined, start=1):
        r["ordinal"] = idx
    return refined


async def analyze_page(
    db: Session,
    page: Page,
    *,
    series_id: str,
    chapter_number: float,
    reading_dir: str,
    page_format: str,
    job_id: str | None = None,
) -> dict:
    pdir = page_dir(series_id, chapter_number, page.index_in_ch)
    orig = pdir / "original.png"
    bgr = cv2.imread(str(orig), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Cannot read {orig}")
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    cv_cands = detect_bubbles_cv(bgr)
    gem = await detect_page_gemini(bgr, reading_dir=reading_dir, job_id=job_id)
    merged = reconcile(cv_cands, gem.get("text_regions", []), gray)
    ordered = sort_reading_order(merged, reading_dir)

    # Clear old regions
    for old in list(page.regions):
        db.delete(old)

    analysis_regions = []
    for r in ordered:
        rid = f"{page.id}/r{r['ordinal']:02d}"
        mask_rel = f"masks/r{r['ordinal']:02d}.png"
        mask_path = pdir / mask_rel
        cv2.imwrite(str(mask_path), r["glyph_mask"])

        region = Region(
            id=rid,
            page_id=page.id,
            ordinal=r["ordinal"],
            kind=r["kind"],
            bbox=json.dumps(r["bbox"]),
            polygon=json.dumps(r["polygon"]) if r.get("polygon") else None,
            status="detected",
            confidence=r["confidence"],
            source=r["source"],
        )
        db.add(region)
        analysis_regions.append(
            {
                "id": rid,
                "ordinal": r["ordinal"],
                "kind": r["kind"],
                "bbox": r["bbox"],
                "polygon": r.get("polygon"),
                "interior_color": r.get("interior_color"),
                "mask": mask_rel,
                "source": r["source"],
                "confidence": r["confidence"],
            }
        )

    analysis = {
        "page_id": page.id,
        "size": [w, h],
        "format": page_format,
        "regions": analysis_regions,
        "characters": gem.get("characters", []),
        "panels": [],
    }
    write_json(pdir / "analysis.json", analysis)
    page.state = "analyzed"
    page.flagged = 1 if any(r["confidence"] < 0.7 or r["source"] != "both" for r in ordered) else 0
    db.commit()
    log.info("page_analyzed", page_id=page.id, regions=len(ordered))
    return analysis
