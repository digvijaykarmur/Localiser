"""Filesystem layout helpers for a series project."""

from __future__ import annotations

from pathlib import Path

from localiser.config import get_settings


def series_dir(series_id: str) -> Path:
    d = get_settings().workspace_root / "projects" / series_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def chapter_dir(series_id: str, chapter_number: float) -> Path:
    ch = f"ch-{int(chapter_number):03d}" if chapter_number == int(chapter_number) else f"ch-{chapter_number}"
    # Prefer consistent ch-001 style; for decimals use ch-010.5 → sanitize
    if chapter_number != int(chapter_number):
        ch = f"ch-{str(chapter_number).replace('.', '_')}"
    else:
        ch = f"ch-{int(chapter_number):03d}"
    d = series_dir(series_id) / "chapters" / ch
    d.mkdir(parents=True, exist_ok=True)
    return d


def chapter_id(series_id: str, chapter_number: float) -> str:
    if chapter_number == int(chapter_number):
        return f"{series_id}/ch-{int(chapter_number):03d}"
    return f"{series_id}/ch-{str(chapter_number).replace('.', '_')}"


def page_id(chapter_id_str: str, index_in_ch: int) -> str:
    return f"{chapter_id_str}/{index_in_ch:03d}"


def page_dir(series_id: str, chapter_number: float, index_in_ch: int) -> Path:
    d = chapter_dir(series_id, chapter_number) / "pages" / f"{index_in_ch:03d}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "masks").mkdir(exist_ok=True)
    (d / "history").mkdir(exist_ok=True)
    return d


def bible_dir(series_id: str) -> Path:
    d = series_dir(series_id) / "bible"
    d.mkdir(parents=True, exist_ok=True)
    (d / "refs").mkdir(exist_ok=True)
    return d


def tm_dir(series_id: str) -> Path:
    d = series_dir(series_id) / "tm"
    d.mkdir(parents=True, exist_ok=True)
    return d


def output_dir(title: str) -> Path:
    d = get_settings().workspace_root / "output" / title
    d.mkdir(parents=True, exist_ok=True)
    return d
