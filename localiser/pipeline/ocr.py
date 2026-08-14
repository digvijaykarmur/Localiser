"""Stage 2 — OCR + script gate (NN-6)."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from sqlalchemy.orm import Session

from localiser.ai import vertex
from localiser.db import Page, Region
from localiser.util import detect_script, log, read_json, write_json
from localiser.util.paths import page_dir


def _load_prompt(name: str) -> str:
    from localiser.config import get_settings

    return (get_settings().prompts_dir / name).read_text(encoding="utf-8")


def _crop_region(bgr: np.ndarray, bbox: list[int], pad: int = 8) -> np.ndarray:
    h, w = bgr.shape[:2]
    x, y, bw, bh = bbox
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(w, x + bw + pad)
    y1 = min(h, y + bh + pad)
    crop = bgr[y0:y1, x0:x1]
    if crop.shape[0] < 40:
        crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_LANCZOS4)
    return crop


async def ocr_page(
    db: Session,
    page: Page,
    *,
    series_id: str,
    chapter_number: float,
    job_id: str | None = None,
) -> None:
    pdir = page_dir(series_id, chapter_number, page.index_in_ch)
    bgr = cv2.imread(str(pdir / "original.png"), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError("missing original")

    regions = (
        db.query(Region)
        .filter(Region.page_id == page.id)
        .order_by(Region.ordinal)
        .all()
    )
    if not regions:
        return

    prompt = _load_prompt("P-OCR.txt")
    # Batch up to 12
    for start in range(0, len(regions), 12):
        batch = regions[start : start + 12]
        images: list[bytes] = []
        mime: list[str] = []
        hints = []
        for i, reg in enumerate(batch, start=1):
            bbox = json.loads(reg.bbox)
            crop = _crop_region(bgr, bbox)
            # Vertical JP hint
            vertical = False
            if bbox[3] / max(1, bbox[2]) > 2.5:
                vertical = True
            ok, buf = cv2.imencode(".png", crop)
            images.append(buf.tobytes())
            mime.append("image/png")
            hints.append(f"{i}:{'vertical' if vertical else 'horizontal'}")

        batch_prompt = (
            prompt
            + "\n\nImage index hints (orientation): "
            + ", ".join(hints)
            + "\nNumbered images follow in order 1.."
            + str(len(batch))
        )
        data = await vertex.generate(
            purpose="vision_bulk",
            prompt=batch_prompt,
            images=images,
            mime_types=mime,
            json_mode=True,
            job_id=job_id,
        )
        results = {int(r["i"]): r for r in data.get("results", []) if "i" in r}

        for i, reg in enumerate(batch, start=1):
            r = results.get(i, {})
            text = (r.get("text") or "").strip()
            reg.src_text = text
            script = detect_script(text)
            reg.src_script = script
            # NN-6: Devanagari is inert
            if script == "deva":
                reg.status = "approved"
                reg.clean_tier = 0
                reg.target_text = text
                log.info("deva_gated", region_id=reg.id)
            elif not text:
                # ink but empty OCR
                mask_path = pdir / f"masks/r{reg.ordinal:02d}.png"
                has_ink = False
                if mask_path.exists():
                    m = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
                    has_ink = m is not None and int(m.sum()) > 0
                if has_ink:
                    reg.status = "ocr_empty"
                    page.flagged = 1
                else:
                    reg.status = "ocr_done"
            else:
                reg.status = "ocr_done"

    # Update analysis.json
    analysis_path = pdir / "analysis.json"
    if analysis_path.exists():
        analysis = read_json(analysis_path)
        by_id = {r.id: r for r in regions}
        for ar in analysis.get("regions", []):
            reg = by_id.get(ar["id"])
            if reg:
                ar["src_text"] = reg.src_text
                ar["src_script"] = reg.src_script
                ar["status"] = reg.status
        write_json(analysis_path, analysis)

    # If every region is already Devanagari → auto-approve page
    regs = db.query(Region).filter(Region.page_id == page.id).all()
    if regs and all(r.src_script == "deva" for r in regs):
        page.state = "approved"
        page.skip_processing = 1
    db.commit()
