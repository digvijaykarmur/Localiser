"""Typesetting Engine — Devanagari (§8).

Engine A (primary): Chromium via Playwright — best Indic shaping available.
Engine B (fallback): Pillow + libraqm.

NOTE: this module is covered by tests/test_no_generative_imports.py — no
generative image client may ever be imported here.
"""
from __future__ import annotations

import asyncio
import io
import json
import re
from pathlib import Path

import cv2
import numpy as np
import structlog
from PIL import Image, ImageFont

from ..ai import vertex
from ..config import CFG, SeriesConfig, load_json
from ..db import PageRow, Region, session
from ..util import atomic_save_png
from .clean import composite_page
from .paths import page_paths

log = structlog.get_logger()

FONTS_DIR = CFG.assets_dir / "fonts"

HTML_TEMPLATE = """<!DOCTYPE html><html><head><style>
{font_faces}
* {{ margin:0; padding:0; }}
body {{ background: transparent; }}
#t {{
  width:{w}px; min-height:{h}px;
  display:flex; align-items:center; justify-content:center;
  font-family:'{font}', 'Noto Sans Devanagari', sans-serif;
  font-size:{size}px; line-height:{leading};
  letter-spacing:{tracking}em; text-align:center;
  color:{color}; -webkit-font-smoothing:antialiased;
  word-break:keep-all; overflow-wrap:break-word;
  white-space:pre-wrap; {extra}
}}
</style></head><body><div id="t">{text}</div></body></html>"""


def _font_faces() -> str:
    faces = []
    if FONTS_DIR.exists():
        for f in FONTS_DIR.glob("*.[ot]tf"):
            name = f.stem
            faces.append(
                f"@font-face {{ font-family:'{name}'; src:url('file://{f.resolve()}'); }}")
    return "\n".join(faces)


class ChromiumRenderer:
    """One browser instance kept alive for the whole job (§8.2)."""

    def __init__(self):
        self._pw = None
        self._browser = None
        self._page = None
        self._lock = asyncio.Lock()

    async def start(self):
        from playwright.async_api import async_playwright

        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch()
        self._page = await self._browser.new_page(
            viewport={"width": 1200, "height": 1200}, device_scale_factor=2)

    async def stop(self):
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()
        self._browser = self._page = self._pw = None

    async def render(self, text: str, font: str, size: int, w: int, h: int,
                     leading: float, tracking: float, color: str,
                     skew: bool = False) -> Image.Image:
        """Transparent screenshot of #t at 2x, LANCZOS downscaled to 1x."""
        if self._page is None:
            await self.start()
        extra = "transform: skewX(-4deg);" if skew else ""
        html = HTML_TEMPLATE.format(
            font_faces=_font_faces(), w=w, h=h, font=font, size=size,
            leading=leading, tracking=tracking, color=color,
            text=(text.replace("&", "&amp;").replace("<", "&lt;")), extra=extra)
        async with self._lock:
            await self._page.set_content(html)
            el = await self._page.query_selector("#t")
            png = await el.screenshot(omit_background=True)
        img = Image.open(io.BytesIO(png)).convert("RGBA")
        return img.resize((max(1, img.width // 2), max(1, img.height // 2)), Image.LANCZOS)


_renderer: ChromiumRenderer | None = None


def get_renderer() -> ChromiumRenderer:
    global _renderer
    if _renderer is None:
        _renderer = ChromiumRenderer()
    return _renderer


# --- Engine B: Pillow + libraqm -------------------------------------------------

def raqm_available() -> bool:
    from PIL import features

    return bool(features.check("raqm"))


def render_raqm(text: str, font_name: str, size: int, w: int, h: int,
                leading: float, color: str) -> Image.Image:
    from PIL import ImageDraw

    font_path = FONTS_DIR / f"{font_name}.ttf"
    if not font_path.exists():
        candidates = list(FONTS_DIR.glob("*.ttf"))
        if not candidates:
            raise RuntimeError("no fonts in assets/fonts")
        font_path = candidates[0]
    font = ImageFont.truetype(str(font_path), size, layout_engine=ImageFont.Layout.RAQM)

    # manual word wrap using font.getlength()
    lines: list[str] = []
    for para in text.split("\n"):
        words, cur = para.split(" "), ""
        for word in words:
            trial = (cur + " " + word).strip()
            if font.getlength(trial) <= w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        lines.append(cur)
    line_h = int(size * leading)
    img = Image.new("RGBA", (w, max(h, line_h * len(lines))), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    y = max(0, (img.height - line_h * len(lines)) // 2)
    for line in lines:
        lw = font.getlength(line)
        draw.text(((w - lw) / 2, y), line, font=font, fill=color)
        y += line_h
    return img


# --- text box from polygon (§8.4.1) ----------------------------------------------

def inscribed_rect(interior_mask: np.ndarray) -> tuple[int, int, int, int]:
    """Largest inscribed axis-aligned rect via distance transform."""
    dt = cv2.distanceTransform((interior_mask > 0).astype(np.uint8), cv2.DIST_L2, 5)
    best = (0, 0, 1, 1)
    best_area = 0
    H, W = interior_mask.shape
    flat = dt.flatten()
    idxs = np.argsort(flat)[::-1][:40]  # top distance maxima as candidate centers
    for idx in idxs:
        cy, cx = divmod(int(idx), W)
        r = int(dt[cy, cx])
        if r < 4:
            break
        w0 = h0 = r
        # greedy expand alternating in x and y while fully inside
        grew = True
        while grew:
            grew = False
            for dw, dh in ((4, 0), (0, 4)):
                nw, nh = w0 + dw, h0 + dh
                x0, x1 = cx - nw, cx + nw
                y0, y1 = cy - nh, cy + nh
                if x0 < 0 or y0 < 0 or x1 >= W or y1 >= H:
                    continue
                ar = (2 * nw) / max(1, 2 * nh)
                if not (0.6 <= ar <= 3.2):
                    continue
                sub = interior_mask[y0:y1, x0:x1]
                if sub.size and (sub > 0).all():
                    w0, h0 = nw, nh
                    grew = True
        area = 4 * w0 * h0
        if area > best_area:
            best_area = area
            best = (cx - w0, cy - h0, 2 * w0, 2 * h0)
    x, y, w, h = best
    pad = max(6, int(0.06 * min(w, h)))
    return (x + pad, y + pad, max(1, w - 2 * pad), max(1, h - 2 * pad))


def sample_text_color(orig: np.ndarray, glyph_mask_page: np.ndarray) -> str:
    """Median color of original glyph pixels (§8.6) — never hardcode black."""
    sel = glyph_mask_page > 0
    if not sel.any():
        return "#141210"
    med = np.median(orig[sel][:, :3], axis=0).astype(int)
    return "#{:02x}{:02x}{:02x}".format(*med)


def style_for(kind: str, src_text: str, fonts) -> dict:
    shouted = bool(src_text) and src_text.upper() == src_text and any(c.isalpha() for c in src_text)
    if kind == "thought":
        return {"font": fonts.thought, "leading": 1.3, "tracking": 0.0, "skew": False}
    if kind == "narration":
        return {"font": fonts.narration, "leading": 1.3, "tracking": 0.0, "skew": False}
    if kind == "sfx":
        return {"font": fonts.sfx, "leading": 1.1, "tracking": 0.0, "skew": False}
    if shouted:
        return {"font": fonts.shout, "leading": 1.22, "tracking": 0.01, "skew": False, "boost": 1.12}
    return {"font": fonts.dialogue, "leading": 1.22, "tracking": 0.0, "skew": False}


# --- fitting ladder (§8.4) ---------------------------------------------------------

async def fit_and_render(renderer: ChromiumRenderer, text: str, style: dict,
                         box: tuple[int, int, int, int], page_width: int,
                         color: str, scfg: SeriesConfig,
                         interior_full: np.ndarray | None,
                         job_id: str | None) -> tuple[Image.Image | None, dict]:
    bx, by, bw, bh = box
    min_size = max(11, int(0.028 * page_width))
    max_size = max(min_size + 1, int(0.075 * page_width))
    leading = style["leading"]
    tracking = style["tracking"]
    boost = style.get("boost", 1.0)

    async def try_size(size: int, w: int, h: int, lead: float, track: float):
        img = await renderer.render(text, style["font"], int(size * boost), w, h,
                                    lead, track, color, style.get("skew", False))
        return img if (img.width <= w + 2 and img.height <= h + 2) else None

    # binary search for largest fitting size
    lo, hi, best = min_size, max_size, None
    while lo <= hi:
        mid = (lo + hi) // 2
        img = await try_size(mid, bw, bh, leading, tracking)
        if img is not None:
            best, lo = (mid, img), mid + 1
        else:
            hi = mid - 1
    if best:
        return best[1], {"size": best[0], "leading": leading, "tracking": tracking}

    # escalation ladder — never past step (d)
    for lead, track in ((1.12, tracking), (1.12, -0.015)):
        img = await try_size(min_size, bw, bh, lead, track)
        if img is not None:
            return img, {"size": min_size, "leading": lead, "tracking": track}

    # (c) ask the model for a shorter line, up to 2 attempts
    chars_fit = max(8, int(bw * bh / (min_size * min_size * 1.6)))
    short = text
    for _ in range(2):
        try:
            data = await vertex.generate(
                vertex.load_prompt("p_shorten", max_chars=chars_fit, text=short),
                model=scfg.models["dialogue"], purpose="dialogue", job_id=job_id,
                use_cache=False)
            short = (data.get("text") or short).strip()
        except Exception:
            break
        img = await renderer.render(short, style["font"], min_size, bw, bh,
                                    1.12, -0.015, color, style.get("skew", False))
        if img.width <= bw + 2 and img.height <= bh + 2:
            return img, {"size": min_size, "leading": 1.12, "tracking": -0.015,
                         "shortened_to": short}

    # (d) grow box up to 8%, only if growth stays inside the bubble polygon
    if interior_full is not None:
        gw, gh = int(bw * 1.08), int(bh * 1.08)
        gx, gy = bx - (gw - bw) // 2, by - (gh - bh) // 2
        H, W = interior_full.shape
        if gx >= 0 and gy >= 0 and gx + gw < W and gy + gh < H:
            sub = interior_full[gy:gy + gh, gx:gx + gw]
            if sub.size and (sub > 0).all():
                img = await try_size(min_size, gw, gh, 1.12, -0.015)
                if img is not None:
                    return img, {"size": min_size, "leading": 1.12,
                                 "tracking": -0.015, "grown_box": [gx, gy, gw, gh]}
    return None, {"overflow": True}


# --- stage driver -------------------------------------------------------------------

async def typeset_page(page_id: str, scfg: SeriesConfig, job_id: str | None = None,
                       only_region_ids: list[str] | None = None) -> dict:
    pp = page_paths(page_id)
    analysis = load_json(pp["analysis"], {})
    orig_img = Image.open(pp["original"]).convert("RGBA")
    orig = np.asarray(orig_img)
    H, W = orig.shape[:2]

    renderer = get_renderer()
    use_chromium = True
    try:
        await renderer.start()
    except Exception as e:
        log.warning("chromium_unavailable_falling_back_to_raqm", error=str(e))
        use_chromium = False
        if not raqm_available():
            raise RuntimeError("Neither Chromium nor Pillow-raqm available for shaping") from e

    text_layer = np.zeros((H, W, 4), np.uint8)
    if pp["text_layer"].exists() and only_region_ids:
        text_layer = np.array(Image.open(pp["text_layer"]).convert("RGBA"))

    budget = np.zeros((H, W), np.uint8)
    if pp["budget"].exists():
        budget = np.array(Image.open(pp["budget"]).convert("L"))

    meta_by_id = {m["id"]: m for m in analysis.get("regions", [])}
    report = {"typeset": 0, "overflow": 0, "skipped": 0}

    with session() as s:
        regions = (s.query(Region).filter(Region.page_id == page_id)
                   .order_by(Region.ordinal).all())

    for r in regions:
        meta = meta_by_id.get(r.id)
        if (not meta or not (r.target_text or "").strip() or r.src_script == "deva"
                or r.kind == "credit" or (r.kind == "sfx" and not scfg.clean.include_sfx)
                or (only_region_ids and r.id not in only_region_ids)
                or r.status in ("skipped",)):
            report["skipped"] += 1
            continue
        # tiny handwritten side-text: skip below 14px (edge #8)
        if meta["bbox"][3] < 14 and r.kind == "sign":
            with session() as s:
                s.get(Region, r.id).status = "flagged"
            report["skipped"] += 1
            continue

        x, y, w, h = meta["bbox"]
        interior_full = None
        interior_path = pp["masks"] / f"r{meta['ordinal']:02d}_interior.png"
        if interior_path.exists():
            small = np.array(Image.open(interior_path).convert("L"))
            if small.shape == (h, w):
                interior_full = np.zeros((H, W), np.uint8)
                interior_full[y:y + h, x:x + w] = small

        if interior_full is not None:
            rx, ry, rw, rh = inscribed_rect(interior_full[y:y + h, x:x + w])
            box = (x + rx, y + ry, rw, rh)
        else:
            pad = max(4, int(0.08 * min(w, h)))
            box = (x + pad, y + pad, max(1, w - 2 * pad), max(1, h - 2 * pad))

        glyph_page = np.zeros((H, W), np.uint8)
        if meta.get("mask"):
            gp = pp["dir"] / meta["mask"]
            if gp.exists():
                g = np.array(Image.open(gp).convert("L"))
                if g.shape == (h, w):
                    glyph_page[y:y + h, x:x + w] = g
        color = sample_text_color(orig, glyph_page)
        style = style_for(r.kind, r.src_text or "", scfg.fonts)

        if use_chromium:
            img, render_info = await fit_and_render(
                renderer, r.target_text, style, box, W, color, scfg,
                interior_full, job_id)
        else:
            img = render_raqm(r.target_text, style["font"],
                              max(11, int(0.028 * W)), box[2], box[3],
                              style["leading"], color)
            render_info = {"engine": "raqm", "size": max(11, int(0.028 * W))}
            if img.width > box[2] + 2 or img.height > box[3] + 2:
                img = None
                render_info = {"overflow": True}

        with session() as s:
            row = s.get(Region, r.id)
            if img is None:
                row.status = "flagged"
                row.render_json = json.dumps({"overflow": True})
                report["overflow"] += 1
                continue

            # paste centered in box
            bx, by_, bw, bh = render_info.get("grown_box", box)
            px = bx + max(0, (bw - img.width) // 2)
            py = by_ + max(0, (bh - img.height) // 2)
            arr = np.asarray(img)
            eh = min(arr.shape[0], H - py)
            ew = min(arr.shape[1], W - px)
            patch = arr[:eh, :ew]

            # text pixels must live inside the budget: extend budget by the
            # rendered-text mask clipped to the bubble interior
            text_mask = (patch[..., 3] > 0).astype(np.uint8) * 255
            region_slice = (slice(py, py + eh), slice(px, px + ew))
            if interior_full is not None:
                clip = interior_full[region_slice]
                text_mask = cv2.bitwise_and(text_mask, clip)
                patch = patch.copy()
                patch[clip == 0] = 0
            budget[region_slice] |= text_mask

            tl = text_layer[region_slice]
            alpha = patch[..., 3:4].astype(np.float32) / 255.0
            text_layer[region_slice] = (
                patch.astype(np.float32) * alpha + tl.astype(np.float32) * (1 - alpha)
            ).astype(np.uint8)

            row.render_json = json.dumps({
                "font": style["font"], "color": color, "box": list(box), **render_info})
            if row.status in ("cleaned", "translated"):
                row.status = "typeset"
            report["typeset"] += 1

    atomic_save_png(Image.fromarray(text_layer), pp["text_layer"])
    atomic_save_png(Image.fromarray(budget), pp["budget"])
    composite_page(page_id)

    with session() as s:
        page = s.get(PageRow, page_id)
        if page.state == "composited":
            page.state = "typeset"

    # deterministic sanity: connected components vs char count
    _cheap_shaping_check(page_id, text_layer)
    return report


def _cheap_shaping_check(page_id: str, text_layer: np.ndarray) -> None:
    alpha = (text_layer[..., 3] > 0).astype(np.uint8)
    if not alpha.any():
        return
    n, _ = cv2.connectedComponents(alpha)
    with session() as s:
        total_chars = sum(len(r.target_text or "") for r in
                          s.query(Region).filter(Region.page_id == page_id).all())
    if total_chars > 20 and n < max(3, total_chars // 20):
        log.warning("shaping_suspect", page=page_id, components=n, chars=total_chars)


# --- Post-render QC (§8.7) ------------------------------------------------------

async def render_qc(page_id: str, scfg: SeriesConfig, job_id: str | None = None) -> list[dict]:
    pp = page_paths(page_id)
    if not pp["composite"].exists():
        return []
    comp = Image.open(pp["composite"]).convert("RGB")
    with session() as s:
        regions = [r for r in (s.query(Region).filter(Region.page_id == page_id)
                               .order_by(Region.ordinal).all())
                   if r.status == "typeset" and r.target_text]
    results = []
    for i in range(0, len(regions), 12):
        batch = regions[i:i + 12]
        crops = []
        for r in batch:
            x, y, w, h = json.loads(r.bbox)
            crops.append(comp.crop((max(0, x - 8), max(0, y - 8),
                                    min(comp.width, x + w + 8), min(comp.height, y + h + 8))))
        data = await vertex.generate(
            vertex.load_prompt("p_renderqc"), model=scfg.models["vision_bulk"],
            purpose="renderqc", images=crops, job_id=job_id)
        for j, r in enumerate(batch, 1):
            res = next((x for x in data.get("results", []) if x.get("i") == j), {})
            ok = (res.get("readable", True) and res.get("inside_bubble", True)
                  and not res.get("clipped") and not res.get("broken_glyphs"))
            results.append({"region_id": r.id, **res, "ok": ok})
            if not ok:
                with session() as s:
                    s.get(Region, r.id).status = "flagged"
    return results
