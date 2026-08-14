"""Stage 2 — OCR + Script Gate (§5 Stage 2)."""
from __future__ import annotations

import json

import structlog
from PIL import Image

from ..ai import vertex
from ..config import SeriesConfig, load_json, dump_json
from ..db import Region, session
from ..util import detect_script
from .paths import page_paths

log = structlog.get_logger()

BATCH = 12
PAD = 8


def _crop_region(img: Image.Image, bbox: list[int]) -> Image.Image:
    x, y, w, h = bbox
    crop = img.crop((max(0, x - PAD), max(0, y - PAD),
                     min(img.width, x + w + PAD), min(img.height, y + h + PAD)))
    if crop.height < 40:  # tiny text: upscale 2x LANCZOS
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
    return crop


async def ocr_page(page_id: str, scfg: SeriesConfig, job_id: str | None = None) -> None:
    pp = page_paths(page_id)
    analysis = load_json(pp["analysis"])
    if not analysis:
        raise RuntimeError(f"page {page_id} has no analysis.json — run detect first")
    img = Image.open(pp["original"]).convert("RGB")

    with session() as s:
        regions = (s.query(Region).filter(Region.page_id == page_id)
                   .order_by(Region.ordinal).all())

    todo = [r for r in regions if r.status == "detected"]
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        crops, vertical = [], False
        for r in batch:
            bbox = json.loads(r.bbox)
            crops.append(_crop_region(img, bbox))
            meta = next((m for m in analysis["regions"] if m["id"] == r.id), {})
            if meta.get("script_guess") == "jpan" and bbox[3] / max(bbox[2], 1) > 2.5:
                vertical = True
        hint = ("\n- These crops contain VERTICAL Japanese text: read each column "
                "top-to-bottom, columns right-to-left.\n") if vertical else ""
        prompt = vertex.load_prompt("p_ocr", vertical_hint=hint)
        preamble = "\n".join(f"Image {j + 1} of {len(batch)}." for j in range(len(batch)))
        data = await vertex.generate(
            prompt + "\n" + preamble, model=scfg.models["vision_bulk"],
            purpose="ocr", images=crops, job_id=job_id,
        )
        results = {r.get("i"): r for r in data.get("results", [])}

        with session() as s:
            for j, r in enumerate(batch, 1):
                res = results.get(j, {})
                text = (res.get("text") or "").strip()
                row = s.get(Region, r.id)
                row.src_text = text
                row.src_script = detect_script(text)
                # NN-6 gate: Devanagari is never touched
                if row.src_script == "deva":
                    row.status = "approved"
                    row.clean_tier = 0
                    row.target_text = text
                    log.info("deva_gated", region=r.id)
                elif not text:
                    row.status = "flagged" if row.source in ("both", "cv_only") else "ocr_done"
                    if row.status == "flagged":
                        log.warning("ocr_empty", region=r.id)
                else:
                    row.status = "ocr_done"

    # mirror to analysis.json
    with session() as s:
        rows = s.query(Region).filter(Region.page_id == page_id).all()
    by_id = {r.id: r for r in rows}
    for meta in analysis["regions"]:
        r = by_id.get(meta["id"])
        if r:
            meta["src_text"] = r.src_text
            meta["src_script"] = r.src_script
            meta["status"] = r.status
    dump_json(pp["analysis"], analysis)
