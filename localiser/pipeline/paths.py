"""On-disk layout helpers (§4.1)."""
from __future__ import annotations

from pathlib import Path

from ..config import CFG


def series_dir(series_id: str) -> Path:
    return CFG.projects_dir / series_id


def bible_dir(series_id: str) -> Path:
    return series_dir(series_id) / "bible"


def tm_dir(series_id: str) -> Path:
    return series_dir(series_id) / "tm"


def chapter_dir(series_id: str, chapter_num: float) -> Path:
    n = f"{chapter_num:g}"
    if chapter_num == int(chapter_num):
        n = f"{int(chapter_num):03d}"
    return series_dir(series_id) / "chapters" / f"ch-{n}"


def chapter_dir_from_id(chapter_id: str) -> Path:
    series_id, ch = chapter_id.split("/", 1)
    return series_dir(series_id) / "chapters" / ch


def page_dir_from_id(page_id: str) -> Path:
    """page_id = '<series>/<ch-xxx>/<idx>'"""
    series_id, ch, idx = page_id.split("/")
    return series_dir(series_id) / "chapters" / ch / "pages" / idx


def page_paths(page_id: str) -> dict[str, Path]:
    d = page_dir_from_id(page_id)
    return {
        "dir": d,
        "original": d / "original.png",
        "analysis": d / "analysis.json",
        "masks": d / "masks",
        "budget": d / "masks" / "budget.png",
        "clean_layer": d / "clean_layer.png",
        "text_layer": d / "text_layer.png",
        "composite": d / "composite.png",
        "diff": d / "diff.png",
        "history": d / "history",
    }
