"""Cleaning Engine — text removal (§7).

FORBIDDEN IMPORTS — enforced by tests/test_no_generative_imports.py, which
walks this module tree's AST and fails on any import matching a denylist:
any image-generation client, any diffusion/inpaint model that regenerates
pixels outside the provided mask.
Cleaning is: (a) sample colors, (b) fill inside mask. Nothing else.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import structlog
from PIL import Image

from ..config import SeriesConfig, load_json
from ..db import PageRow, Region, session
from ..util import atomic_save_png
from .budget import BudgetViolation, verify_change_budget
from .paths import page_paths

log = structlog.get_logger()

HISTORY_KEEP = 20


# ---------------------------------------------------------------------------
# §7.3 Mask construction
# ---------------------------------------------------------------------------

def _stroke_width(glyph: np.ndarray) -> float:
    contours, _ = cv2.findContours(glyph, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    areas = sum(cv2.contourArea(c) for c in contours)
    perim = sum(cv2.arcLength(c, True) for c in contours)
    return 2.0 * areas / perim if perim > 0 else 2.0


def build_region_mask(page_shape: tuple[int, int], region_meta: dict,
                      pdir: Path) -> tuple[np.ndarray, float]:
    """Full-page uint8 mask for one region + clean_risk contribution factors."""
    H, W = page_shape
    mask = np.zeros((H, W), np.uint8)
    x, y, w, h = region_meta["bbox"]
    x, y = max(0, x), max(0, y)
    w, h = min(w, W - x), min(h, H - y)
    if w <= 0 or h <= 0:
        return mask, 1.0

    glyph = None
    if region_meta.get("mask"):
        gp = pdir / region_meta["mask"]
        if gp.exists():
            glyph = np.array(Image.open(gp).convert("L"))
    if glyph is None or glyph.shape != (h, w):
        glyph = np.full((h, w), 255, np.uint8)

    sw = _stroke_width(glyph)
    dil = max(2, round(sw * 0.6))
    glyph = cv2.dilate(glyph, np.ones((dil * 2 + 1, dil * 2 + 1), np.uint8))

    interior_path = pdir / "masks" / f"r{region_meta['ordinal']:02d}_interior.png"
    clipped_to_polygon = False
    if region_meta.get("polygon") and interior_path.exists():
        interior = np.array(Image.open(interior_path).convert("L"))
        if interior.shape == (h, w):
            # the key safety step: geometrically impossible to touch border art
            interior = cv2.erode(interior, np.ones((5, 5), np.uint8), iterations=1)
            glyph = cv2.bitwise_and(glyph, interior)
            clipped_to_polygon = True
    if not clipped_to_polygon:
        # no polygon (SFX over artwork): clip to bbox inset by 1px, raise risk
        inset = np.zeros((h, w), np.uint8)
        inset[1:h - 1, 1:w - 1] = 255
        glyph = cv2.bitwise_and(glyph, inset)

    mask[y:y + h, x:x + w] = glyph
    return mask, (0.0 if clipped_to_polygon else 0.25)


def compute_clean_risk(orig_gray: np.ndarray, mask: np.ndarray,
                       bubble_area: float, char_boxes: list[list[float]],
                       base_risk: float) -> float:
    """§7.4: weighted sum — mask/bubble area (0.3), Canny edge density under
    the mask (0.4), overlap with character boxes (0.3)."""
    mask_area = float(np.count_nonzero(mask))
    if mask_area == 0:
        return 0.0
    a = min(1.0, mask_area / max(bubble_area, 1.0))
    edges = cv2.Canny(orig_gray, 60, 160)
    e = float(np.count_nonzero(edges[mask > 0])) / mask_area
    e = min(1.0, e * 4)
    ys, xs = np.nonzero(mask)
    mx0, my0, mx1, my1 = xs.min(), ys.min(), xs.max(), ys.max()
    c = 0.0
    for x0, y0, x1, y1 in char_boxes:
        ix0, iy0 = max(mx0, x0), max(my0, y0)
        ix1, iy1 = min(mx1, x1), min(my1, y1)
        if ix1 > ix0 and iy1 > iy0:
            c = 1.0
            break
    return min(1.0, 0.3 * a + 0.4 * e + 0.3 * c + base_risk)


# ---------------------------------------------------------------------------
# §7.4 Fill tiers
# ---------------------------------------------------------------------------

def choose_tier_and_fill(orig: np.ndarray, mask: np.ndarray, interior: np.ndarray | None,
                         page_area: int, risk: float, risk_abort: float,
                         max_tier: int) -> tuple[int, np.ndarray | None]:
    """Returns (tier, rgba_fill or None if deferred). Fill has alpha only in mask."""
    if risk > risk_abort:
        return 4, None

    sel = mask > 0
    if interior is not None:
        non_glyph = (interior > 0) & ~sel
    else:
        ys, xs = np.nonzero(sel)
        pad = 6
        y0, y1 = max(0, ys.min() - pad), min(orig.shape[0], ys.max() + pad)
        x0, x1 = max(0, xs.min() - pad), min(orig.shape[1], xs.max() + pad)
        ring = np.zeros_like(mask, bool)
        ring[y0:y1, x0:x1] = True
        non_glyph = ring & ~sel

    if not non_glyph.any():
        return 4, None
    samples = orig[non_glyph][:, :3].astype(np.float64)
    std = samples.std(axis=0)

    fill = np.zeros((*orig.shape[:2], 4), np.uint8)

    # Tier 1 — flat fill
    if float(std.max()) < 4.0:
        med = np.median(samples, axis=0).astype(np.uint8)
        fill[sel] = [*med, 255]
        return 1, fill

    # Tier 2 — gradient (plane) fill + matched noise
    if float(std.max()) < 18.0 and max_tier >= 2:
        ys, xs = np.nonzero(non_glyph)
        A = np.stack([xs, ys, np.ones_like(xs)], axis=1).astype(np.float64)
        mys, mxs = np.nonzero(sel)
        M = np.stack([mxs, mys, np.ones_like(mxs)], axis=1).astype(np.float64)
        ok = True
        planes = np.zeros((len(mys), 3))
        for ch in range(3):
            b = samples[:, ch]
            coef, res, *_ = np.linalg.lstsq(A, b, rcond=None)
            pred = A @ coef
            ss_res = float(((b - pred) ** 2).sum())
            ss_tot = float(((b - b.mean()) ** 2).sum()) or 1.0
            r2 = 1 - ss_res / ss_tot
            if r2 < 0.9:
                ok = False
                break
            sigma = float(np.sqrt(ss_res / max(1, len(b))))
            vals = M @ coef + np.random.default_rng(0).normal(0, sigma, len(mys))
            planes[:, ch] = np.clip(vals, 0, 255)
        if ok:
            fill[mys, mxs, :3] = planes.astype(np.uint8)
            fill[mys, mxs, 3] = 255
            return 2, fill

    # Tier 3 — local Telea inpaint through the mask only
    mask_area = int(np.count_nonzero(sel))
    if max_tier >= 3 and mask_area < 0.04 * page_area:
        ys, xs = np.nonzero(sel)
        pad = 16
        y0, y1 = max(0, ys.min() - pad), min(orig.shape[0], ys.max() + pad)
        x0, x1 = max(0, xs.min() - pad), min(orig.shape[1], xs.max() + pad)
        tile = cv2.cvtColor(orig[y0:y1, x0:x1, :3], cv2.COLOR_RGB2BGR)
        tile_mask = mask[y0:y1, x0:x1]
        painted = cv2.inpaint(tile, tile_mask, 3, cv2.INPAINT_TELEA)
        painted_rgb = cv2.cvtColor(painted, cv2.COLOR_BGR2RGB)
        sub = sel[y0:y1, x0:x1]
        tys, txs = np.nonzero(sub)
        fill[y0 + tys, x0 + txs, :3] = painted_rgb[tys, txs]
        fill[y0 + tys, x0 + txs, 3] = 255
        return 3, fill

    return 4, None


# ---------------------------------------------------------------------------
# Layer model + compositing (§7.2)
# ---------------------------------------------------------------------------

def snapshot_history(pp: dict, page_version: int) -> None:
    hist = pp["history"]
    hist.mkdir(parents=True, exist_ok=True)
    for name in ("clean_layer", "text_layer"):
        src = pp[name]
        if src.exists():
            (hist / f"v{page_version:03d}_{name}.png").write_bytes(src.read_bytes())
    snaps = sorted(hist.glob("v*_*.png"))
    while len(snaps) > HISTORY_KEEP * 2:
        snaps.pop(0).unlink()


def composite_page(page_id: str) -> None:
    """original ⊕ clean_layer ⊕ text_layer → composite, then verify budget.
    On violation: discard layers, restore from history, mark page error."""
    pp = page_paths(page_id)
    orig = Image.open(pp["original"]).convert("RGBA")
    comp = orig.copy()
    for layer_name in ("clean_layer", "text_layer"):
        lp = pp[layer_name]
        if lp.exists():
            layer = Image.open(lp).convert("RGBA")
            if layer.size == comp.size:
                comp.alpha_composite(layer)
    atomic_save_png(comp, pp["composite"])

    try:
        verify_change_budget(pp["dir"])
    except BudgetViolation:
        _rollback(pp)
        with session() as s:
            page = s.get(PageRow, page_id)
            page.state = "error"
        raise

    with session() as s:
        page = s.get(PageRow, page_id)
        page.version = (page.version or 0) + 1
        if page.state in ("translated", "cleaned", "typeset"):
            page.state = "composited"


def _rollback(pp: dict) -> None:
    hist = sorted(pp["history"].glob("v*_clean_layer.png"))
    for name in ("clean_layer", "text_layer"):
        pp[name].unlink(missing_ok=True)
        snaps = sorted(pp["history"].glob(f"v*_{name}.png"))
        if snaps:
            pp[name].write_bytes(snaps[-1].read_bytes())
    pp["composite"].unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Stage driver
# ---------------------------------------------------------------------------

def clean_page(page_id: str, scfg: SeriesConfig,
               only_region_ids: list[str] | None = None) -> dict:
    pp = page_paths(page_id)
    analysis = load_json(pp["analysis"], {})
    orig_img = Image.open(pp["original"]).convert("RGBA")
    orig = np.asarray(orig_img)
    orig_gray = cv2.cvtColor(orig[..., :3], cv2.COLOR_RGB2GRAY)
    H, W = orig.shape[:2]
    page_area = H * W
    char_boxes = [c.get("px", [0, 0, 0, 0]) for c in analysis.get("characters", [])]

    with session() as s:
        regions = (s.query(Region).filter(Region.page_id == page_id)
                   .order_by(Region.ordinal).all())
        page = s.get(PageRow, page_id)
        page_version = page.version or 0

    snapshot_history(pp, page_version)

    clean_layer = np.zeros((H, W, 4), np.uint8)
    if pp["clean_layer"].exists() and only_region_ids:
        clean_layer = np.array(Image.open(pp["clean_layer"]).convert("RGBA"))

    budget = np.zeros((H, W), np.uint8)
    report = {"cleaned": 0, "deferred": 0, "skipped": 0}
    meta_by_id = {m["id"]: m for m in analysis.get("regions", [])}

    with session() as s:
        for r in regions:
            row = s.get(Region, r.id)
            meta = meta_by_id.get(r.id)
            # inert regions: deva (NN-6), credits (NN-9/edge #9), sfx unless enabled
            if (not meta or r.src_script == "deva" or r.kind == "credit"
                    or (r.kind == "sfx" and not scfg.clean.include_sfx)
                    or r.status == "skipped"):
                report["skipped"] += 1
                continue
            if only_region_ids and r.id not in only_region_ids:
                # keep the existing mask contribution in the budget
                mask, _ = build_region_mask((H, W), meta, pp["dir"])
                if row.clean_tier and row.clean_tier < 4:
                    budget |= mask
                continue

            mask, base_risk = build_region_mask((H, W), meta, pp["dir"])
            if not mask.any():
                report["skipped"] += 1
                continue
            Image.fromarray(mask).save(pp["masks"] / f"r{meta['ordinal']:02d}_full.png")

            interior = None
            interior_path = pp["masks"] / f"r{meta['ordinal']:02d}_interior.png"
            if interior_path.exists():
                small = np.array(Image.open(interior_path).convert("L"))
                x, y, w, h = meta["bbox"]
                if small.shape == (h, w):
                    interior = np.zeros((H, W), np.uint8)
                    interior[y:y + h, x:x + w] = small
            bubble_area = float(np.count_nonzero(interior)) if interior is not None \
                else float(meta["bbox"][2] * meta["bbox"][3])

            risk_abort = scfg.clean.risk_abort if r.kind != "sfx" else 0.6
            risk = compute_clean_risk(orig_gray, mask, bubble_area, char_boxes, base_risk)
            tier, fill = choose_tier_and_fill(
                orig, mask, interior, page_area, risk, risk_abort, scfg.clean.max_tier)

            row.clean_tier = tier
            row.clean_risk = risk
            if tier == 4 or fill is None:
                row.status = "flagged"
                report["deferred"] += 1
                continue

            sel = fill[..., 3] > 0
            clean_layer[sel] = fill[sel]
            budget |= mask
            if row.status in ("translated", "ocr_done"):
                row.status = "cleaned"
            report["cleaned"] += 1

    atomic_save_png(Image.fromarray(clean_layer), pp["clean_layer"])
    pp["masks"].mkdir(parents=True, exist_ok=True)
    atomic_save_png(Image.fromarray(budget), pp["budget"])

    composite_page(page_id)
    with session() as s:
        page = s.get(PageRow, page_id)
        if page.state == "composited":
            page.state = "cleaned"
    return report
