import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageCms, UnidentifiedImageError
from sqlalchemy import select

from .config import get_settings
from .db import Chapter, Page, Series, session_scope

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".avif"}
CHAPTER_PATTERNS = (
    re.compile(r"(?:ch(?:apter)?[\s._-]*)(\d+(?:\.\d+)?)", re.I),
    re.compile(r"^(\d+(?:\.\d+)?)"),
)


def natural_key(value: str) -> list[int | str]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or "untitled-series"


def chapter_number(name: str, fallback: int) -> float:
    for pattern in CHAPTER_PATTERNS:
        match = pattern.search(name)
        if match:
            return float(match.group(1))
    return float(fallback)


@dataclass
class IngestReport:
    series_id: str
    chapters: int = 0
    pages: int = 0
    duplicates: int = 0
    warnings: list[str] = field(default_factory=list)
    rejected: list[str] = field(default_factory=list)


def _chapter_folders(root: Path) -> list[tuple[str, Path]]:
    children = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: natural_key(p.name))
    if children:
        return [(child.name, child) for child in children]
    return [("Chapter 01", root)]


def _images(folder: Path, report: IngestReport) -> list[Path]:
    result: list[Path] = []
    for item in folder.iterdir():
        if item.is_file() and item.suffix.casefold() in IMAGE_EXTENSIONS:
            result.append(item)
        elif item.is_file():
            report.rejected.append(str(item))
        elif item.is_dir():
            report.warnings.append(f"Nested folder ignored: {item}")
    return sorted(result, key=lambda p: natural_key(p.name))


def _decode_srgb(path: Path) -> tuple[Image.Image, np.ndarray]:
    with Image.open(path) as source:
        source.load()
        if source.mode == "CMYK":
            try:
                source = ImageCms.profileToProfile(
                    source,
                    ImageCms.createProfile("sRGB"),
                    ImageCms.createProfile("sRGB"),
                    outputMode="RGBA",
                )
            except Exception:
                source = source.convert("RGBA")
        else:
            source = source.convert("RGBA")
        pixels = np.asarray(source)
        return source.copy(), pixels


def ingest_series(
    *, title: str, title_hi: str | None, input_path: str, reading_dir: str, format_hint: str | None
) -> IngestReport:
    source_root = Path(input_path).expanduser().resolve()
    if not source_root.is_dir():
        raise ValueError(f"Input folder does not exist: {source_root}")

    settings = get_settings()
    series_id = slugify(title)
    report = IngestReport(series_id=series_id)
    project_root = settings.workspace / "projects" / series_id

    with session_scope() as db:
        if db.scalar(select(Series).where(Series.id == series_id)):
            raise ValueError(f"Series '{series_id}' already exists")

        folders = _chapter_folders(source_root)
        decoded: list[tuple[str, Path, list[tuple[Path, Image.Image, np.ndarray]]]] = []
        aspect_ratios: list[float] = []
        for folder_name, folder in folders:
            page_data = []
            for path in _images(folder, report):
                try:
                    image, pixels = _decode_srgb(path)
                except (OSError, ValueError, UnidentifiedImageError) as exc:
                    report.warnings.append(f"Unreadable image {path}: {exc}")
                    continue
                aspect_ratios.append(image.height / max(image.width, 1))
                page_data.append((path, image, pixels))
            if page_data:
                decoded.append((folder_name, folder, page_data))
            else:
                report.warnings.append(f"Empty chapter skipped: {folder}")

        if not decoded:
            raise ValueError("No readable images found")
        detected_format = "longstrip" if float(np.median(aspect_ratios)) > 3 else "page"
        chosen_format = format_hint or detected_format
        if reading_dir not in {"ltr", "rtl"}:
            raise ValueError("reading_dir must be ltr or rtl")

        db.add(
            Series(
                id=series_id,
                title=title,
                title_hi=title_hi,
                input_path=str(source_root),
                reading_dir=reading_dir,
                format=chosen_format,
            )
        )
        for fallback, (folder_name, _, page_data) in enumerate(decoded, 1):
            number = chapter_number(folder_name, fallback)
            chapter_id = f"{series_id}/ch-{number:g}".replace(".", "-")
            chapter = Chapter(
                id=chapter_id,
                series_id=series_id,
                number=number,
                title_src=folder_name,
                page_count=len(page_data),
            )
            db.add(chapter)
            seen_hashes: set[str] = set()
            for index, (src, image, pixels) in enumerate(page_data, 1):
                digest = hashlib.sha256(pixels.tobytes()).hexdigest()
                duplicate = digest in seen_hashes
                seen_hashes.add(digest)
                page_id = f"{chapter_id}/{index:03d}"
                page_dir = project_root / "chapters" / chapter_id.split("/")[-1] / "pages" / f"{index:03d}"
                page_dir.mkdir(parents=True, exist_ok=True)
                original = page_dir / "original.png"
                image.save(original, format="PNG", compress_level=6)
                original.chmod(0o444)
                (page_dir / "masks").mkdir(exist_ok=True)
                db.add(
                    Page(
                        id=page_id,
                        chapter_id=chapter_id,
                        index_in_ch=index,
                        src_filename=src.name,
                        width=image.width,
                        height=image.height,
                        sha256=digest,
                        duplicate=duplicate,
                        skip_processing=duplicate,
                    )
                )
                report.pages += 1
                report.duplicates += int(duplicate)
            report.chapters += 1
        db.commit()
    return report
