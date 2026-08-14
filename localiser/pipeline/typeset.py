"""Devanagari typesetting — Chromium/Playwright primary, Pillow+raqm fallback."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.orm import Session

from localiser.db import Page, Region
from localiser.util import log
from localiser.util.paths import page_dir

_browser = None
_playwright = None


def _fonts_dir() -> Path:
    from localiser.config import get_settings

    return get_settings().fonts_dir


def font_path(role_name: str) -> Path | None:
    """Map font role name to a file under assets/fonts."""
    fd = _fonts_dir()
    candidates = [
        fd / f"{role_name}.ttf",
        fd / f"{role_name}.otf",
        fd / f"{role_name.replace('-', '')}.ttf",
    ]
    # Also try common Google Fonts filenames
    mapping = {
        "Mukta-SemiBold": ["Mukta-SemiBold.ttf", "MuktaSemiBold.ttf"],
        "Mukta-Regular": ["Mukta-Regular.ttf", "MuktaRegular.ttf"],
        "Mukta-ExtraBold": ["Mukta-ExtraBold.ttf", "MuktaExtraBold.ttf"],
        "Kalam-Regular": ["Kalam-Regular.ttf", "KalamRegular.ttf"],
        "YatraOne-Regular": ["YatraOne-Regular.ttf", "YatraOne.ttf"],
        "Baloo2-Regular": ["Baloo2-Regular.ttf", "Baloo2-Medium.ttf"],
    }
    for name in mapping.get(role_name, []):
        candidates.append(fd / name)
    for c in candidates:
        if c.exists():
            return c
    # any ttf
    ttf = list(fd.glob("*.ttf")) + list(fd.glob("*.otf"))
    return ttf[0] if ttf else None


async def get_browser():
    global _browser, _playwright
    if _browser is not None:
        return _browser
    from playwright.async_api import async_playwright

    _playwright = await async_playwright().start()
    _browser = await _playwright.chromium.launch(headless=True)
    return _browser


async def close_browser():
    global _browser, _playwright
    if _browser:
        await _browser.close()
        _browser = None
    if _playwright:
        await _playwright.stop()
        _playwright = None


async def render_deva_chromium(
    text: str,
    *,
    width: int,
    height: int,
    font_file: Path,
    size: int,
    leading: float = 1.22,
    tracking: float = 0.0,
    color: str = "000000",
    skew: bool = False,
) -> Image.Image:
    browser = await get_browser()
    page = await browser.new_page(
        viewport={"width": max(width, 32), "height": max(height, 32)},
        device_scale_factor=2,
    )
    skew_css = "transform:skewX(-4deg);" if skew else ""
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
@font-face {{
  font-family: 'MangaDeva';
  src: url('file://{font_file.resolve().as_posix()}') format('truetype');
}}
html,body{{margin:0;padding:0;background:transparent;}}
#t{{
  width:{width}px;height:{height}px;
  display:flex;align-items:center;justify-content:center;
  font-family:'MangaDeva',sans-serif;font-size:{size}px;line-height:{leading};
  letter-spacing:{tracking}em;text-align:center;
  color:#{color};-webkit-font-smoothing:antialiased;
  word-break:keep-all;overflow-wrap:break-word;{skew_css}
  white-space:pre-wrap;
}}
</style></head><body><div id="t">{_escape_html(text)}</div></body></html>"""
    await page.set_content(html, wait_until="load")
    el = page.locator("#t")
    png = await el.screenshot(omit_background=True)
    await page.close()
    img = Image.open(__import__("io").BytesIO(png)).convert("RGBA")
    # downscale from 2x
    img = img.resize((width, height), Image.Resampling.LANCZOS)
    return img


def _escape_html(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_deva_pillow(
    text: str,
    *,
    width: int,
    height: int,
    font_file: Path,
    size: int,
    leading: float = 1.22,
    color: tuple[int, int, int] = (0, 0, 0),
) -> Image.Image:
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    try:
        font = ImageFont.truetype(
            str(font_file), size=size, layout_engine=ImageFont.LAYOUT_RAQM
        )
    except Exception:
        font = ImageFont.truetype(str(font_file), size=size)

    draw = ImageDraw.Draw(img)
    lines = _wrap_text(text, font, width - 8)
    line_h = int(size * leading)
    total_h = line_h * len(lines)
    y = max(0, (height - total_h) // 2)
    for line in lines:
        lw = font.getlength(line) if hasattr(font, "getlength") else draw.textlength(line, font=font)
        x = max(0, int((width - lw) / 2))
        draw.text((x, y), line, font=font, fill=color + (255,))
        y += line_h
    return img


def _wrap_text(text: str, font, max_w: float) -> list[str]:
    words = text.replace("\n", " \n ").split(" ")
    lines: list[str] = []
    cur = ""
    for w in words:
        if w == "\n":
            lines.append(cur)
            cur = ""
            continue
        trial = (cur + " " + w).strip()
        length = font.getlength(trial) if hasattr(font, "getlength") else len(trial) * font.size * 0.6
        if length <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    # avoid single-char orphans
    if len(lines) >= 2 and len(lines[-1]) <= 1:
        lines[-2] = lines[-2] + " " + lines[-1]
        lines.pop()
    return lines or [text]


def largest_inscribed_rect(polygon: list[list[int]] | None, bbox: list[int], shape: tuple[int, int]) -> tuple[int, int, int, int]:
    h, w = shape
    mask = np.zeros((h, w), dtype=np.uint8)
    if polygon:
        cv2.fillPoly(mask, [np.array(polygon, dtype=np.int32)], 255)
    else:
        x, y, bw, bh = bbox
        cv2.rectangle(mask, (x, y), (x + bw, y + bh), 255, -1)
    mask = cv2.erode(mask, np.ones((3, 3), np.uint8), 1)
    dt = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    if dt.max() <= 0:
        x, y, bw, bh = bbox
        pad = max(6, int(0.06 * min(bw, bh)))
        return x + pad, y + pad, max(8, bw - 2 * pad), max(8, bh - 2 * pad)

    # sample local maxima
    best = None
    best_area = 0
    step = max(2, int(dt.max() // 4) or 2)
    ys, xs = np.where(dt >= dt.max() * 0.6)
    for cy, cx in zip(ys[::step], xs[::step]):
        r = float(dt[cy, cx])
        # expand axis-aligned rect
        for aspect in (1.0, 1.6, 2.2, 0.7, 2.8):
            half_w = r / max(aspect, 0.01) ** 0.5
            half_h = r * max(aspect, 0.01) ** 0.5
            # binary expand while inside
            for scale in (1.0, 0.9, 0.8, 0.7):
                ww = int(2 * half_w * scale)
                hh = int(2 * half_h * scale)
                if ww < 8 or hh < 8:
                    continue
                x0 = int(cx - ww / 2)
                y0 = int(cy - hh / 2)
                x1, y1 = x0 + ww, y0 + hh
                if x0 < 0 or y0 < 0 or x1 > w or y1 > h:
                    continue
                sub = mask[y0:y1, x0:x1]
                if sub.size and np.all(sub > 0):
                    area = ww * hh
                    ar = ww / max(hh, 1)
                    if 0.6 <= ar <= 3.2 and area > best_area:
                        best_area = area
                        best = (x0, y0, ww, hh)
    if best:
        x, y, bw, bh = best
        pad = max(6, int(0.06 * min(bw, bh)))
        return x + pad, y + pad, max(8, bw - 2 * pad), max(8, bh - 2 * pad)
    x, y, bw, bh = bbox
    pad = max(6, int(0.06 * min(bw, bh)))
    return x + pad, y + pad, max(8, bw - 2 * pad), max(8, bh - 2 * pad)


def sample_glyph_color(bgr: np.ndarray, mask: np.ndarray) -> tuple[int, int, int]:
    pixels = bgr[mask > 0]
    if pixels.size == 0:
        return (20, 18, 16)
    # dark glyphs: take darker median
    dark = pixels[pixels.mean(axis=1) < 140]
    if len(dark):
        med = np.median(dark, axis=0)
    else:
        med = np.median(pixels, axis=0)
    # BGR → RGB
    return int(med[2]), int(med[1]), int(med[0])


async def typeset_page(
    db: Session,
    page: Page,
    *,
    series_id: str,
    chapter_number: float,
    fonts: dict[str, str] | None = None,
) -> None:
    from localiser.schemas import FontsConfig

    fonts = fonts or FontsConfig().model_dump()
    pdir = page_dir(series_id, chapter_number, page.index_in_ch)
    bgr = cv2.imread(str(pdir / "original.png"), cv2.IMREAD_COLOR)
    h, w = bgr.shape[:2]
    text_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    regions = (
        db.query(Region)
        .filter(Region.page_id == page.id)
        .order_by(Region.ordinal)
        .all()
    )

    for reg in regions:
        if reg.src_script == "deva":
            continue
        if reg.kind == "credit":
            continue
        if not reg.target_text:
            continue
        if reg.kind == "sfx":
            # only if include_sfx was cleaned — check clean_tier
            if not reg.clean_tier:
                continue

        bbox = json.loads(reg.bbox)
        polygon = json.loads(reg.polygon) if reg.polygon else None
        tx, ty, tw, th = largest_inscribed_rect(polygon, bbox, (h, w))

        role = {
            "dialogue": fonts.get("dialogue", "Mukta-SemiBold"),
            "thought": fonts.get("thought", "Kalam-Regular"),
            "narration": fonts.get("narration", "Mukta-Regular"),
            "ui_window": fonts.get("dialogue", "Mukta-SemiBold"),
            "sfx": fonts.get("sfx", "YatraOne-Regular"),
            "sign": fonts.get("narration", "Mukta-Regular"),
            "unknown": fonts.get("dialogue", "Mukta-SemiBold"),
        }.get(reg.kind, fonts.get("dialogue", "Mukta-SemiBold"))

        # shout detection
        if reg.src_text and reg.src_text.isupper() and len(reg.src_text) > 3:
            role = fonts.get("shout", "Mukta-ExtraBold")

        fp = font_path(role)
        if not fp:
            log.warning("font_missing", role=role)
            page.flagged = 1
            reg.status = "flagged"
            continue

        mask_path = pdir / f"masks/r{reg.ordinal:02d}.png"
        glyph = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if glyph is None:
            glyph = np.zeros((h, w), dtype=np.uint8)
        rgb = sample_glyph_color(bgr, glyph)
        color_hex = f"{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"

        min_size = max(11, int(0.028 * w))
        max_size = int(0.075 * w)
        leading = 1.22 if reg.kind == "dialogue" else 1.3
        tracking = 0.0
        if reg.src_text and reg.src_text.isupper():
            tracking = 0.01
            max_size = int(max_size * 1.12)

        # binary search font size
        best_img = None
        lo, hi = min_size, max_size
        best_size = min_size
        while lo <= hi:
            mid = (lo + hi) // 2
            try:
                img = await render_deva_chromium(
                    reg.target_text,
                    width=tw,
                    height=th,
                    font_file=fp,
                    size=mid,
                    leading=leading,
                    tracking=tracking,
                    color=color_hex,
                    skew=(reg.kind == "thought"),
                )
            except Exception as e:
                log.warning("chromium_render_failed", error=str(e))
                img = render_deva_pillow(
                    reg.target_text,
                    width=tw,
                    height=th,
                    font_file=fp,
                    size=mid,
                    leading=leading,
                    color=rgb,
                )
            # check if content fits: non-zero alpha bbox within
            alpha = np.array(img.split()[-1])
            if alpha.max() == 0:
                hi = mid - 1
                continue
            ys, xs = np.where(alpha > 10)
            content_h = ys.max() - ys.min() + 1
            content_w = xs.max() - xs.min() + 1
            if content_h <= th * 0.98 and content_w <= tw * 0.98:
                best_img = img
                best_size = mid
                lo = mid + 1
            else:
                hi = mid - 1

        if best_img is None:
            # escalation: reduce leading/tracking then flag
            leading = 1.12
            tracking = -0.015
            try:
                best_img = await render_deva_chromium(
                    reg.target_text,
                    width=tw,
                    height=th,
                    font_file=fp,
                    size=min_size,
                    leading=leading,
                    tracking=tracking,
                    color=color_hex,
                )
            except Exception:
                best_img = render_deva_pillow(
                    reg.target_text,
                    width=tw,
                    height=th,
                    font_file=fp,
                    size=min_size,
                    leading=leading,
                    color=rgb,
                )
            alpha = np.array(best_img.split()[-1])
            if alpha.max() == 0 or (np.where(alpha > 10)[0].size and (
                (np.where(alpha > 10)[0].max() - np.where(alpha > 10)[0].min()) > th
            )):
                reg.status = "flagged"
                page.flagged = 1
                continue

        text_layer.paste(best_img, (tx, ty), best_img)
        reg.render_json = json.dumps(
            {
                "font": role,
                "size": best_size,
                "leading": leading,
                "box": [tx, ty, tw, th],
                "align": "center",
                "color": color_hex,
            }
        )
        reg.status = "typeset"

    text_layer.save(pdir / "text_layer.png")
    hist = pdir / "history"
    hist.mkdir(exist_ok=True)
    text_layer.save(hist / f"v{page.version + 1:03d}_text_layer.png")
    page.state = "typeset"
    db.commit()
    log.info("page_typeset", page_id=page.id)


def shaping_self_test() -> dict:
    """Startup Devanagari shaping check."""
    from PIL import features

    raqm = bool(features.check("raqm"))
    sample = "क्षत्रिय हिंदी में लिखा है — प्रिय, कृष्ण, द्वारा"
    fp = font_path("Mukta-Regular") or font_path("Mukta-SemiBold")
    result = {"raqm": raqm, "font": str(fp) if fp else None, "ok": False, "note": ""}
    if not fp:
        result["note"] = "No Devanagari font in assets/fonts"
        return result
    try:
        img = render_deva_pillow(sample, width=600, height=80, font_file=fp, size=28)
        alpha = np.array(img.split()[-1])
        # crude: enough ink pixels for the sample
        ink = int(np.count_nonzero(alpha > 10))
        result["ink_pixels"] = ink
        result["ok"] = ink > 200
        if not result["ok"]:
            result["note"] = "Rendered sample has too little ink — shaping may be broken"
        # save reference for visual debug
        from localiser.config import get_settings

        qa = get_settings().assets_dir / "qa"
        qa.mkdir(parents=True, exist_ok=True)
        img.save(qa / "deva_selftest.png")
    except Exception as e:
        result["note"] = str(e)
    return result
