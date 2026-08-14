"""Stage 1 — Region Detection (§5 Stage 1).

Two independent detectors (CV + Gemini), then reconciliation.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import structlog
from PIL import Image

from ..ai import vertex
from ..config import SeriesConfig, dump_json
from ..db import Region, PageRow, session
from .paths import page_paths

log = structlog.get_logger()

TILE_H = 2000
TILE_OVERLAP = 300


@dataclass
class BubbleCandidate:
    polygon: list[list[int]]
    bbox: tuple[int, int, int, int]           # x, y, w, h
    interior_color: tuple[int, int, int]
    glyph_mask: np.ndarray                    # uint8 mask, page-sized crop coords
    interior_mask: np.ndarray


@dataclass
class DetectedRegion:
    ordinal: int
    kind: str
    bbox: list[int]
    polygon: list[list[int]] | None
    mask: np.ndarray | None
    interior_mask: np.ndarray | None
    interior_color: list[int] | None
    source: str
    confidence: float
    script_guess: str = "other"
    speaker_hint: str | None = None
    connected_to: int | None = None


# ---------------------------------------------------------------------------
# 1A. CV detector — deterministic, precise edges
# ---------------------------------------------------------------------------

def cv_detect(page_bgr: np.ndarray) -> list[BubbleCandidate]:
    gray = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2GRAY)
    page_area = gray.shape[0] * gray.shape[1]

    _, bright = cv2.threshold(gray, 235, 255, cv2.THRESH_BINARY)
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(bright, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    out: list[BubbleCandidate] = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < 0.0004 * page_area or area > 0.35 * page_area:
            continue
        hull = cv2.convexHull(c)
        hull_area = cv2.contourArea(hull)
        if hull_area <= 0:
            continue
        solidity = area / hull_area
        if solidity < 0.55:
            continue
        x, y, w, h = cv2.boundingRect(c)
        roi = gray[y:y + h, x:x + w]
        ink = float(np.count_nonzero(roi < 110)) / roi.size
        if not (0.02 < ink < 0.55):
            continue

        poly = cv2.approxPolyDP(c, 0.01 * cv2.arcLength(c, True), True).reshape(-1, 2)
        interior = np.zeros(gray.shape, np.uint8)
        cv2.drawContours(interior, [c], -1, 255, thickness=cv2.FILLED)
        interior_roi = interior[y:y + h, x:x + w]

        bright_px = roi[roi > 235]
        interior_color = int(np.median(bright_px)) if bright_px.size else 250

        # glyph mask inside the candidate
        glyph = cv2.adaptiveThreshold(
            roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 9
        )
        glyph = cv2.bitwise_and(glyph, interior_roi)
        glyph = _remove_small_components(glyph, min_area=6)
        glyph = cv2.dilate(glyph, np.ones((3, 3), np.uint8), iterations=2)
        glyph = cv2.bitwise_and(glyph, interior_roi)

        out.append(BubbleCandidate(
            polygon=[[int(px + 0), int(py + 0)] for px, py in poly],
            bbox=(x, y, w, h),
            interior_color=(interior_color,) * 3,
            glyph_mask=glyph,
            interior_mask=interior_roi,
        ))
    return out


def _remove_small_components(mask: np.ndarray, min_area: int) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = np.zeros_like(mask)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            out[labels == i] = 255
    return out


# ---------------------------------------------------------------------------
# 1B. Gemini detector — semantics, classification, reading order (tiled)
# ---------------------------------------------------------------------------

def _tiles(height: int) -> list[tuple[int, int]]:
    if height <= TILE_H:
        return [(0, height)]
    tiles, y = [], 0
    while y < height:
        y2 = min(y + TILE_H, height)
        tiles.append((y, y2))
        if y2 >= height:
            break
        y = y2 - TILE_OVERLAP
    return tiles


async def gemini_detect(img: Image.Image, scfg: SeriesConfig, job_id: str | None = None) -> dict:
    """Returns {"text_regions": [...page-px boxes...], "characters": [...]}."""
    W, H = img.size
    all_regions: list[dict] = []
    all_chars: list[dict] = []

    for t_idx, (y0, y1) in enumerate(_tiles(H)):
        tile = img.crop((0, y0, W, y1))
        prompt = vertex.load_prompt("p_detect", reading_dir=scfg.reading_dir)
        data = await vertex.generate(
            prompt, model=scfg.models["vision_bulk"], purpose="detect",
            images=[tile], job_id=job_id,
        )
        th = y1 - y0
        for r in data.get("text_regions", []):
            b = r.get("box") or [0, 0, 0, 0]
            x0p = b[0] / 1000 * W
            y0p = b[1] / 1000 * th + y0
            x1p = b[2] / 1000 * W
            y1p = b[3] / 1000 * th + y0
            all_regions.append({**r, "px": [x0p, y0p, x1p, y1p], "tile": t_idx})
        for c in data.get("characters", []):
            b = c.get("box") or [0, 0, 0, 0]
            all_chars.append({**c, "px": [b[0] / 1000 * W, b[1] / 1000 * th + y0,
                                          b[2] / 1000 * W, b[3] / 1000 * th + y0]})

    merged = _nms_merge(all_regions, iou_thr=0.5)
    merged = _sort_reading_order(merged, scfg.reading_dir)
    return {"text_regions": merged, "characters": _nms_merge(all_chars, iou_thr=0.5)}


def _iou(a: list[float], b: list[float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    ua = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / ua if ua > 0 else 0.0


def _nms_merge(items: list[dict], iou_thr: float) -> list[dict]:
    """Cross-tile merge: boxes over threshold union together (seam crossing)."""
    out: list[dict] = []
    for it in items:
        merged = False
        for o in out:
            if _iou(it["px"], o["px"]) >= iou_thr:
                o["px"] = [min(o["px"][0], it["px"][0]), min(o["px"][1], it["px"][1]),
                           max(o["px"][2], it["px"][2]), max(o["px"][3], it["px"][3])]
                merged = True
                break
        if not merged:
            out.append(dict(it))
    return out


def _sort_reading_order(regions: list[dict], reading_dir: str) -> list[dict]:
    if not regions:
        return regions
    heights = sorted(r["px"][3] - r["px"][1] for r in regions)
    band = 0.6 * heights[len(heights) // 2]

    def key(r: dict):
        yc = (r["px"][1] + r["px"][3]) / 2
        xc = (r["px"][0] + r["px"][2]) / 2
        band_i = int(yc / band) if band > 0 else 0
        return (band_i, xc if reading_dir == "ltr" else -xc, r.get("order", 0))

    return sorted(regions, key=key)


# ---------------------------------------------------------------------------
# 1C. Reconciliation
# ---------------------------------------------------------------------------

def _glyph_mask_from_bbox(gray: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray:
    x, y, w, h = bbox
    roi = gray[y:y + h, x:x + w]
    if roi.size == 0:
        return np.zeros((max(h, 1), max(w, 1)), np.uint8)
    glyph = cv2.adaptiveThreshold(roi, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                  cv2.THRESH_BINARY_INV, 25, 9)
    glyph = _remove_small_components(glyph, 6)
    return cv2.dilate(glyph, np.ones((3, 3), np.uint8), iterations=2)


def reconcile(gemini_out: dict, cv_candidates: list[BubbleCandidate],
              gray: np.ndarray) -> list[DetectedRegion]:
    used_cv: set[int] = set()
    regions: list[DetectedRegion] = []
    ordinal = 0

    for g in gemini_out.get("text_regions", []):
        ordinal += 1
        gx0, gy0, gx1, gy1 = [int(round(v)) for v in g["px"]]
        gbox = [gx0, gy0, gx1, gy1]
        best_i, best_iou = -1, 0.0
        for i, c in enumerate(cv_candidates):
            if i in used_cv:
                continue
            cx, cy, cw, chh = c.bbox
            iou = _iou(gbox, [cx, cy, cx + cw, cy + chh])
            if iou > best_iou:
                best_i, best_iou = i, iou
        if best_i >= 0 and best_iou >= 0.4:
            used_cv.add(best_i)
            c = cv_candidates[best_i]
            x, y, w, h = c.bbox
            regions.append(DetectedRegion(
                ordinal=ordinal, kind=g.get("kind", "dialogue"),
                bbox=[x, y, w, h], polygon=c.polygon,
                mask=c.glyph_mask, interior_mask=c.interior_mask,
                interior_color=list(c.interior_color),
                source="both", confidence=0.95,
                script_guess=g.get("script_guess", "other"),
                speaker_hint=g.get("speaker_hint"),
                connected_to=g.get("connected_to"),
            ))
        else:
            w, h = max(1, gx1 - gx0), max(1, gy1 - gy0)
            gx0c, gy0c = max(0, gx0), max(0, gy0)
            regions.append(DetectedRegion(
                ordinal=ordinal, kind=g.get("kind", "dialogue"),
                bbox=[gx0c, gy0c, w, h], polygon=None,
                mask=_glyph_mask_from_bbox(gray, (gx0c, gy0c, w, h)),
                interior_mask=None, interior_color=None,
                source="gemini_only", confidence=0.65,
                script_guess=g.get("script_guess", "other"),
                speaker_hint=g.get("speaker_hint"),
                connected_to=g.get("connected_to"),
            ))

    for i, c in enumerate(cv_candidates):
        if i in used_cv:
            continue
        ordinal += 1
        x, y, w, h = c.bbox
        regions.append(DetectedRegion(
            ordinal=ordinal, kind="unknown", bbox=[x, y, w, h],
            polygon=c.polygon, mask=c.glyph_mask, interior_mask=c.interior_mask,
            interior_color=list(c.interior_color),
            source="cv_only", confidence=0.50,
        ))
    return regions


# ---------------------------------------------------------------------------
# Stage driver
# ---------------------------------------------------------------------------

async def analyze_page(page_id: str, scfg: SeriesConfig, job_id: str | None = None) -> dict:
    pp = page_paths(page_id)
    img = Image.open(pp["original"]).convert("RGB")
    page_bgr = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(page_bgr, cv2.COLOR_BGR2GRAY)

    cv_cands = cv_detect(page_bgr)
    gem = await gemini_detect(img, scfg, job_id)
    regions = reconcile(gem, cv_cands, gray)

    pp["masks"].mkdir(parents=True, exist_ok=True)
    analysis = {
        "page_id": page_id,
        "size": [img.width, img.height],
        "format": scfg.format,
        "characters": gem.get("characters", []),
        "regions": [],
    }

    with session() as s:
        # wipe previous detection for idempotent re-run
        s.query(Region).filter(Region.page_id == page_id).delete()

        for r in regions:
            rid = f"{page_id}/r{r.ordinal:02d}"
            mask_rel = None
            if r.mask is not None and r.mask.size:
                mask_rel = f"masks/r{r.ordinal:02d}.png"
                Image.fromarray(r.mask).save(pp["dir"] / mask_rel)
            if r.interior_mask is not None:
                Image.fromarray(r.interior_mask).save(pp["masks"] / f"r{r.ordinal:02d}_interior.png")
            analysis["regions"].append({
                "id": rid, "ordinal": r.ordinal, "kind": r.kind,
                "bbox": r.bbox, "polygon": r.polygon,
                "interior_color": r.interior_color, "mask": mask_rel,
                "source": r.source, "confidence": r.confidence,
                "speaker_hint": r.speaker_hint, "connected_to": r.connected_to,
            })
            s.add(Region(
                id=rid, page_id=page_id, ordinal=r.ordinal, kind=r.kind,
                bbox=json.dumps(r.bbox), polygon=json.dumps(r.polygon) if r.polygon else None,
                source=r.source, confidence=r.confidence,
                status="detected",
            ))
        page = s.get(PageRow, page_id)
        page.state = "analyzed"

    dump_json(pp["analysis"], analysis)
    return analysis
