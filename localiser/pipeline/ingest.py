"""Stage 0 — Ingest (§5 Stage 0).

Walk the input folder, register chapters/pages, copy originals losslessly.
"""
from __future__ import annotations

from pathlib import Path

import structlog
from PIL import Image

from ..config import ACCEPTED_IMAGE_EXTS, CFG, SeriesConfig
from ..db import Chapter, PageRow, Series, session
from ..util import (
    atomic_save_png,
    load_original_rgb,
    natural_key,
    parse_chapter_number,
    pixel_sha256,
)
from .paths import chapter_dir, series_dir

log = structlog.get_logger()


def _chapter_id(series_id: str, number: float) -> str:
    if number == int(number):
        return f"{series_id}/ch-{int(number):03d}"
    return f"{series_id}/ch-{number:g}"


def _list_image_files(folder: Path) -> tuple[list[Path], list[Path]]:
    accepted, rejected = [], []
    for f in sorted(folder.iterdir(), key=lambda p: natural_key(p.name)):
        if f.is_file():
            (accepted if f.suffix.lower() in ACCEPTED_IMAGE_EXTS else rejected).append(f)
        elif f.is_dir():
            # nested chapter folders → flatten one level, warn
            log.warning("nested_folder_flattened", folder=str(f))
            a2, r2 = _list_image_files(f)
            accepted.extend(a2)
            rejected.extend(r2)
    return accepted, rejected


def ingest_series(scfg: SeriesConfig, progress=None) -> dict:
    """Returns a report: chapters, pages, rejected files, errors."""
    input_path = Path(scfg.input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"input path does not exist: {input_path}")

    report = {"chapters": 0, "pages": 0, "rejected": [], "errors": [], "duplicates": []}

    # 1. discover chapters: immediate sub-dirs, or root images = "Chapter 01"
    subdirs = sorted([d for d in input_path.iterdir() if d.is_dir()], key=lambda p: natural_key(p.name))
    root_images = [f for f in input_path.iterdir() if f.is_file() and f.suffix.lower() in ACCEPTED_IMAGE_EXTS]
    chapter_folders: list[tuple[float, str, Path]] = []
    if subdirs:
        for i, d in enumerate(subdirs):
            num = parse_chapter_number(d.name)
            if num is None:
                num = float(i + 1)  # fallback: alphabetical index
            chapter_folders.append((num, d.name, d))
    if root_images and not subdirs:
        chapter_folders.append((1.0, "Chapter 01", input_path))

    heights_over_width: list[float] = []

    with session() as s:
        if not s.get(Series, scfg.id):
            s.add(Series(
                id=scfg.id, title=scfg.title, title_hi=scfg.title_hi,
                input_path=str(input_path), reading_dir=scfg.reading_dir,
                format=scfg.format, rights_status=scfg.rights_status,
            ))

    total_pages = sum(len(_list_image_files(d)[0]) for _, _, d in chapter_folders)
    done = 0

    for number, name, folder in chapter_folders:
        files, rejected = _list_image_files(folder)
        report["rejected"] += [str(f) for f in rejected]
        if not files:
            log.warning("empty_chapter_skipped", folder=str(folder))
            continue

        ch_id = _chapter_id(scfg.id, number)
        with session() as s:
            if not s.get(Chapter, ch_id):
                s.add(Chapter(id=ch_id, series_id=scfg.id, number=number,
                              title_src=name, page_count=len(files), state="new"))
            else:
                s.get(Chapter, ch_id).page_count = len(files)
        report["chapters"] += 1

        seen_hashes: dict[str, str] = {}
        for idx, f in enumerate(files, 1):
            page_id = f"{ch_id.split('/')[0]}/{ch_id.split('/')[1]}/{idx:03d}"
            pdir = chapter_dir(scfg.id, number) / "pages" / f"{idx:03d}"
            try:
                img = load_original_rgb(f)
                sha = pixel_sha256(img)
                dup_of = seen_hashes.get(sha)
                if dup_of:
                    report["duplicates"].append({"page": page_id, "duplicate_of": dup_of})
                seen_hashes.setdefault(sha, page_id)
                orig = pdir / "original.png"
                if not orig.exists():
                    atomic_save_png(img, orig)
                    try:
                        orig.chmod(0o444)  # read-only: originals immutable (NN-7)
                    except OSError:
                        pass
                heights_over_width.append(img.height / img.width)
                with session() as s:
                    if not s.get(PageRow, page_id):
                        s.add(PageRow(
                            id=page_id, chapter_id=ch_id, index_in_ch=idx,
                            src_filename=f.name, width=img.width, height=img.height,
                            sha256=sha, state="new",
                            skip_processing=1 if dup_of else 0,
                        ))
                report["pages"] += 1
            except Exception as e:
                log.error("page_ingest_error", file=str(f), error=str(e))
                report["errors"].append({"file": str(f), "error": str(e)})
                with session() as s:
                    if not s.get(PageRow, page_id):
                        s.add(PageRow(id=page_id, chapter_id=ch_id, index_in_ch=idx,
                                      src_filename=f.name, sha256="", state="error"))
            done += 1
            if progress:
                progress(done, total_pages)

    # 7. format detection: median(h/w) > 3.0 → longstrip
    if heights_over_width:
        heights_over_width.sort()
        median = heights_over_width[len(heights_over_width) // 2]
        detected = "longstrip" if median > 3.0 else "page"
        if detected != scfg.format:
            scfg.format = detected
            scfg.save(CFG.projects_dir)
            with session() as s:
                s.get(Series, scfg.id).format = detected

    scfg.save(CFG.projects_dir)
    series_dir(scfg.id).mkdir(parents=True, exist_ok=True)
    return report
