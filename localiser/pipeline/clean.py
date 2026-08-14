"""Cleaning engine — mask-only fills. NO generative image models. NN-1/NN-2."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from sqlalchemy.orm import Session

# FORBIDDEN IMPORTS — enforced by tests/test_no_generative_imports.py:
#   any image-generation client, any diffusion/inpaint model that regenerates
#   pixels outside the provided mask.
# Cleaning is: (a) sample colors, (b) fill inside mask. Nothing else.
# Allowed: cv2.inpaint TELEA/NS which operates through the mask only.

from localiser.db import Page, Region
from localiser.util import atomic_write_png, log, read_json, write_json
from localiser.util.paths import page_dir


class BudgetViolation(Exception):
    pass


def verify_change_budget(page_dir_path: Path) -> None:
    orig = np.array(Image.open(page_dir_path / "original.png").convert("RGBA"))
    comp = np.array(Image.open(page_dir_path / "composite.png").convert("RGBA"))
    budget_path = page_dir_path / "masks" / "budget.png"
    if not budget_path.exists():
        raise BudgetViolation("missing budget.png")
    budget = np.array(Image.open(budget_path).convert("L")) > 0

    if orig.shape[:2] != comp.shape[:2]:
        raise BudgetViolation("dimensions changed")

    outside = ~budget
    if not np.array_equal(orig[outside], comp[outside]):
        diff = np.argwhere(np.any(orig != comp, axis=2) & outside)
        raise BudgetViolation(
            f"{len(diff)} pixels changed outside the approved mask; "
            f"first at (y={diff[0][0]}, x={diff[0][1]})"
        )


def _stroke_width(mask: np.ndarray) -> float:
    ys, xs = np.where(mask > 0)
    if len(xs) < 4:
        return 2.0
    # approximate via area/perimeter of components
    n, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), 8)
    widths = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        # perimeter approx from contour
        comp = (labels == i).astype(np.uint8) * 255
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        peri = cv2.arcLength(cnts[0], True) or 1.0
        widths.append(2.0 * area / peri)
    return float(np.median(widths)) if widths else 2.0


def build_region_mask(
    glyph: np.ndarray,
    polygon: list[list[int]] | None,
    bbox: list[int],
    page_shape: tuple[int, int],
) -> tuple[np.ndarray, float]:
    """Return clipped mask + clean_risk heuristic."""
    h, w = page_shape
    mask = (glyph > 0).astype(np.uint8) * 255
    sw = _stroke_width(mask)
    dilate_k = max(2, int(round(sw * 0.6)))
    mask = cv2.dilate(
        mask,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_k * 2 + 1, dilate_k * 2 + 1)),
        iterations=1,
    )

    risk = 0.0
    if polygon:
        bubble = np.zeros((h, w), dtype=np.uint8)
        pts = np.array(polygon, dtype=np.int32)
        cv2.fillPoly(bubble, [pts], 255)
        bubble = cv2.erode(bubble, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), 1)
        mask = cv2.bitwise_and(mask, bubble)
    else:
        # SFX / no polygon — clip to bbox inset 1px, raise risk
        x, y, bw, bh = bbox
        clip = np.zeros((h, w), dtype=np.uint8)
        cv2.rectangle(clip, (x + 1, y + 1), (x + bw - 2, y + bh - 2), 255, -1)
        mask = cv2.bitwise_and(mask, clip)
        risk += 0.35

    area = float(np.count_nonzero(mask))
    bubble_area = float(np.count_nonzero(cv2.bitwise_or(mask, mask))) or 1.0
    if polygon:
        bubble = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(bubble, [np.array(polygon, dtype=np.int32)], 255)
        bubble_area = float(np.count_nonzero(bubble)) or 1.0
    risk += 0.3 * min(1.0, area / bubble_area)
    return mask, risk


def _choose_tier(
    bgr: np.ndarray,
    mask: np.ndarray,
    polygon: list[list[int]] | None,
    bbox: list[int],
    risk: float,
    risk_abort: float,
    max_tier: int,
) -> int:
    if risk > risk_abort:
        return 4
    h, w = bgr.shape[:2]
    if polygon:
        interior = np.zeros((h, w), dtype=np.uint8)
        cv2.fillPoly(interior, [np.array(polygon, dtype=np.int32)], 255)
        interior = cv2.erode(interior, np.ones((3, 3), np.uint8), 1)
        sample = (interior > 0) & (mask == 0)
    else:
        x, y, bw, bh = bbox
        sample = np.zeros((h, w), dtype=bool)
        sample[y : y + bh, x : x + bw] = True
        sample &= mask == 0

    pixels = bgr[sample]
    if pixels.size == 0:
        return 1 if max_tier >= 1 else 4
    std = float(np.std(pixels.astype(np.float32), axis=0).mean())
    if std < 4.0:
        return 1
    if std < 18.0 and max_tier >= 2:
        # quick R² plane fit check
        ys, xs = np.where(sample)
        if len(xs) > 50:
            A = np.stack([xs.astype(np.float64), ys.astype(np.float64), np.ones(len(xs))], axis=1)
            r2s = []
            for ch in range(3):
                yv = pixels[:, ch].astype(np.float64)
                coef, *_ = np.linalg.lstsq(A, yv, rcond=None)
                pred = A @ coef
                ss_res = np.sum((yv - pred) ** 2)
                ss_tot = np.sum((yv - yv.mean()) ** 2) or 1.0
                r2s.append(1 - ss_res / ss_tot)
            if float(np.mean(r2s)) > 0.9:
                return 2
    mask_area = float(np.count_nonzero(mask))
    page_area = float(h * w)
    if mask_area < 0.04 * page_area and max_tier >= 3:
        return 3
    return 3 if max_tier >= 3 else 1


def _fill_tier1(bgr: np.ndarray, mask: np.ndarray, sample_mask: np.ndarray) -> np.ndarray:
    pixels = bgr[sample_mask]
    if pixels.size == 0:
        color = np.array([252, 252, 250], dtype=np.uint8)
    else:
        color = np.median(pixels, axis=0).astype(np.uint8)
    out = bgr.copy()
    out[mask > 0] = color
    return out


def _fill_tier2(bgr: np.ndarray, mask: np.ndarray, sample_mask: np.ndarray) -> np.ndarray:
    ys, xs = np.where(sample_mask)
    if len(xs) < 20:
        return _fill_tier1(bgr, mask, sample_mask)
    A = np.stack([xs.astype(np.float64), ys.astype(np.float64), np.ones(len(xs))], axis=1)
    out = bgr.copy().astype(np.float64)
    my, mx = np.where(mask > 0)
    if len(mx) == 0:
        return bgr
    Am = np.stack([mx.astype(np.float64), my.astype(np.float64), np.ones(len(mx))], axis=1)
    for ch in range(3):
        yv = bgr[:, :, ch][sample_mask].astype(np.float64)
        coef, residual, *_ = np.linalg.lstsq(A, yv, rcond=None)
        pred = Am @ coef
        sigma = float(np.sqrt(residual[0] / len(yv))) if len(residual) else 1.0
        noise = np.random.normal(0, max(0.5, sigma), size=len(pred))
        out[my, mx, ch] = np.clip(pred + noise, 0, 255)
    return out.astype(np.uint8)


def _fill_tier3(bgr: np.ndarray, mask: np.ndarray, bbox: list[int]) -> np.ndarray:
    x, y, bw, bh = bbox
    pad = 8
    h, w = bgr.shape[:2]
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(w, x + bw + pad), min(h, y + bh + pad)
    tile = bgr[y0:y1, x0:x1].copy()
    m = mask[y0:y1, x0:x1]
    inpainted = cv2.inpaint(tile, m, 3, cv2.INPAINT_TELEA)
    out = bgr.copy()
    # paste back THROUGH the mask only
    sel = m > 0
    out[y0:y1, x0:x1][sel] = inpainted[sel]
    return out


def clean_page(
    db: Session,
    page: Page,
    *,
    series_id: str,
    chapter_number: float,
    include_sfx: bool = False,
    max_tier: int = 3,
    risk_abort: float = 0.85,
) -> None:
    pdir = page_dir(series_id, chapter_number, page.index_in_ch)
    bgr = cv2.imread(str(pdir / "original.png"), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError("missing original")
    h, w = bgr.shape[:2]
    regions = (
        db.query(Region)
        .filter(Region.page_id == page.id)
        .order_by(Region.ordinal)
        .all()
    )

    budget = np.zeros((h, w), dtype=np.uint8)
    working = bgr.copy()

    for reg in regions:
        if reg.src_script == "deva" or reg.clean_tier == 0:
            continue
        if reg.kind == "credit":
            continue
        if reg.kind == "sfx" and not include_sfx:
            continue

        bbox = json.loads(reg.bbox)
        polygon = json.loads(reg.polygon) if reg.polygon else None
        mask_path = pdir / f"masks/r{reg.ordinal:02d}.png"
        glyph = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if glyph is None:
            glyph = np.zeros((h, w), dtype=np.uint8)

        mask, risk = build_region_mask(glyph, polygon, bbox, (h, w))

        # Edge density under mask (artwork signal)
        edges = cv2.Canny(bgr, 80, 160)
        edge_density = float(edges[mask > 0].mean() / 255.0) if np.any(mask) else 0.0
        risk += 0.4 * edge_density
        reg.clean_risk = risk

        abort = 0.6 if (reg.kind == "sfx" and include_sfx) else risk_abort
        tier = _choose_tier(working, mask, polygon, bbox, risk, abort, max_tier)
        reg.clean_tier = tier

        if tier == 4:
            page.flagged = 1
            reg.status = "flagged"
            continue

        if polygon:
            interior = np.zeros((h, w), dtype=np.uint8)
            cv2.fillPoly(interior, [np.array(polygon, dtype=np.int32)], 255)
            sample = (interior > 0) & (mask == 0)
        else:
            x, y, bw, bh = bbox
            sample = np.zeros((h, w), dtype=bool)
            sample[y : y + bh, x : x + bw] = True
            sample &= mask == 0

        before = working.copy()
        if tier == 1:
            working = _fill_tier1(working, mask, sample)
        elif tier == 2:
            working = _fill_tier2(working, mask, sample)
        else:
            working = _fill_tier3(working, mask, bbox)

        budget = cv2.bitwise_or(budget, mask)
        reg.status = "cleaned"

    # clean_layer = RGBA delta vs original (only where budget)
    orig_rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
    work_rgba = cv2.cvtColor(working, cv2.COLOR_BGR2RGBA)
    clean_layer = np.zeros_like(orig_rgba)
    sel = budget > 0
    clean_layer[sel] = work_rgba[sel]
    clean_layer[~sel, 3] = 0
    # where budget, alpha=255
    clean_layer[sel, 3] = 255

    cv2.imwrite(str(pdir / "masks" / "budget.png"), budget)
    Image.fromarray(clean_layer).save(pdir / "clean_layer.png")

    # Snapshot history
    hist = pdir / "history"
    hist.mkdir(exist_ok=True)
    ver = page.version + 1
    Image.fromarray(clean_layer).save(hist / f"v{ver:03d}_clean_layer.png")

    page.state = "cleaned"
    db.commit()
    log.info("page_cleaned", page_id=page.id)


def compose_page(
    db: Session,
    page: Page,
    *,
    series_id: str,
    chapter_number: float,
) -> None:
    pdir = page_dir(series_id, chapter_number, page.index_in_ch)
    orig = Image.open(pdir / "original.png").convert("RGBA")
    clean_path = pdir / "clean_layer.png"
    text_path = pdir / "text_layer.png"

    comp = orig.copy()
    if clean_path.exists():
        clean = Image.open(clean_path).convert("RGBA")
        comp = Image.alpha_composite(comp, clean)
    if text_path.exists():
        text = Image.open(text_path).convert("RGBA")
        comp = Image.alpha_composite(comp, text)

    atomic_write_png(pdir / "composite.png", comp)
    verify_change_budget(pdir)
    page.version += 1
    page.state = "composited"
    db.commit()
    log.info("page_composited", page_id=page.id, version=page.version)
