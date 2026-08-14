"""Stage 0 — Ingest: walk folder, copy originals, create DB rows."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from sqlalchemy.orm import Session

from localiser.config import get_settings, slugify
from localiser.db import Chapter, Page, Series, utcnow
from localiser.schemas import ModelsConfig, SeriesConfig
from localiser.util import (
    IMAGE_EXTS,
    atomic_write_png,
    list_images,
    log,
    natural_key,
    parse_chapter_number,
    pixel_sha256,
    write_json,
)
from localiser.util.paths import chapter_dir, chapter_id, page_dir, page_id, series_dir


def _load_image_srgb(path: Path) -> Image.Image:
    img = Image.open(path)
    # Convert CMYK / odd modes to sRGB once at ingest; that becomes the original.
    if img.mode == "CMYK":
        img = img.convert("RGB")
    elif img.mode == "RGBA":
        pass
    elif img.mode == "P":
        img = img.convert("RGBA" if "transparency" in img.info else "RGB")
    elif img.mode not in ("RGB", "L", "RGBA"):
        img = img.convert("RGB")
    if img.mode == "L":
        img = img.convert("RGB")
    return img


def discover_chapters(input_path: Path) -> list[tuple[str, Path, list[Path], list[Path]]]:
    """Return list of (folder_name, folder_path, accepted_images, rejected)."""
    if not input_path.is_dir():
        raise FileNotFoundError(f"Input path not found: {input_path}")

    subdirs = [p for p in sorted(input_path.iterdir(), key=lambda x: natural_key(x.name)) if p.is_dir()]
    results: list[tuple[str, Path, list[Path], list[Path]]] = []

    if not subdirs:
        # Images directly in root → single Chapter 01
        accepted, rejected = list_images(input_path)
        if accepted:
            results.append(("Chapter 01", input_path, accepted, rejected))
        return results

    for sd in subdirs:
        # Flatten one nested level with warning
        accepted, rejected = list_images(sd)
        nested = [p for p in sd.iterdir() if p.is_dir()]
        if nested and not accepted:
            for n in sorted(nested, key=lambda x: natural_key(x.name)):
                a, r = list_images(n)
                accepted.extend(a)
                rejected.extend(r)
            log.warning("nested_chapter_flattened", folder=str(sd))
        if not accepted:
            log.warning("empty_chapter_skipped", folder=str(sd))
            continue
        results.append((sd.name, sd, accepted, rejected))
    return results


def ingest_series(
    db: Session,
    *,
    title: str,
    title_hi: str | None,
    input_path: str,
    reading_dir: str = "ltr",
    format_hint: str | None = None,
    name_policy: str = "transliterate",
    rights_status: str = "internal_test",
) -> Series:
    cfg = get_settings()
    src = Path(input_path).expanduser().resolve()
    series_id = slugify(title)
    discovered = discover_chapters(src)

    if not discovered:
        raise ValueError(f"No chapter images found under {src}")

    # Format detection from median aspect
    ratios: list[float] = []
    for _, _, images, _ in discovered:
        for im_path in images[:5]:
            try:
                with Image.open(im_path) as im:
                    w, h = im.size
                    if w > 0:
                        ratios.append(h / w)
            except OSError:
                continue
    detected_format = "longstrip" if ratios and float(np.median(ratios)) > 3.0 else "page"
    fmt = format_hint or detected_format
    if reading_dir not in ("ltr", "rtl"):
        reading_dir = "ltr" if fmt == "longstrip" else "ltr"

    existing = db.get(Series, series_id)
    if existing:
        raise ValueError(f"Series already exists: {series_id}")

    series = Series(
        id=series_id,
        title=title,
        title_hi=title_hi,
        input_path=str(src),
        reading_dir=reading_dir,
        format=fmt,
        name_policy=name_policy,
        rights_status=rights_status,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(series)

    sdir = series_dir(series_id)
    (sdir / "logs").mkdir(exist_ok=True)
    (sdir / "tm").mkdir(exist_ok=True)
    (sdir / "bible").mkdir(exist_ok=True)

    models = ModelsConfig(**cfg.models)
    series_cfg = SeriesConfig(
        id=series_id,
        title=title,
        title_hi=title_hi,
        input_path=str(src),
        reading_dir=reading_dir,  # type: ignore[arg-type]
        format=fmt,  # type: ignore[arg-type]
        name_policy=name_policy,  # type: ignore[arg-type]
        rights_status=rights_status,  # type: ignore[arg-type]
        models=models,
    )
    write_json(sdir / "series.json", series_cfg.model_dump())

    reject_report: list[str] = []

    for idx, (folder_name, _folder, images, rejected) in enumerate(discovered, start=1):
        for r in rejected:
            reject_report.append(f"{folder_name}/{r.name}")
        number = parse_chapter_number(folder_name, idx)
        cid = chapter_id(series_id, number)
        ch = Chapter(
            id=cid,
            series_id=series_id,
            number=number,
            title_src=folder_name,
            page_count=0,
            state="new",
        )
        db.add(ch)
        chapter_dir(series_id, number)

        seen_hashes: dict[str, str] = {}
        page_count = 0
        for i, img_path in enumerate(images, start=1):
            try:
                pil = _load_image_srgb(img_path)
            except OSError as e:
                log.error("unreadable_page", path=str(img_path), error=str(e))
                continue

            arr = np.array(pil.convert("RGBA"))
            digest = pixel_sha256(arr)
            pid = page_id(cid, i)
            pdir = page_dir(series_id, number, i)
            out_path = pdir / "original.png"
            atomic_write_png(out_path, pil.convert("RGBA") if pil.mode == "RGBA" else pil.convert("RGB").convert("RGBA"))
            # Make original immutable-ish
            try:
                out_path.chmod(0o444)
            except OSError:
                pass

            skip = 0
            if digest in seen_hashes:
                skip = 1
                log.warning("duplicate_page", page=pid, twin=seen_hashes[digest])
            else:
                seen_hashes[digest] = pid

            w, h = pil.size
            page = Page(
                id=pid,
                chapter_id=cid,
                index_in_ch=i,
                src_filename=img_path.name,
                width=w,
                height=h,
                sha256=digest,
                state="new" if not skip else "duplicate",
                skip_processing=skip,
            )
            db.add(page)
            page_count += 1

        ch.page_count = page_count
        write_json(
            chapter_dir(series_id, number) / "chapter.state.json",
            {"id": cid, "number": number, "state": "new", "page_count": page_count},
        )

    if reject_report:
        write_json(sdir / "logs" / "rejected_files.json", reject_report)
        log.warning("rejected_non_image_files", count=len(reject_report), files=reject_report[:20])

    db.commit()
    db.refresh(series)
    log.info("ingest_complete", series_id=series_id, chapters=len(discovered))
    return series
