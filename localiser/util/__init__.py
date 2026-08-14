"""Shared utilities: natural sort, hashing, logging, paths."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import structlog

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

log = structlog.get_logger("localiser")


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def natural_key(s: str) -> list:
    """Split digit runs and compare numerically — never pure lexicographic."""
    parts = re.split(r"(\d+(?:\.\d+)?)", s)
    key: list = []
    for p in parts:
        if not p:
            continue
        try:
            key.append(float(p) if "." in p else int(p))
        except ValueError:
            key.append(p.lower())
    return key


_CHAPTER_RE = [
    re.compile(r"(?:ch(?:apter)?[\s._-]*)(\d+(?:\.\d+)?)", re.I),
    re.compile(r"^(\d+(?:\.\d+)?)"),
]


def parse_chapter_number(folder_name: str, fallback_index: int) -> float:
    for rx in _CHAPTER_RE:
        m = rx.search(folder_name)
        if m:
            return float(m.group(1))
    return float(fallback_index)


def pixel_sha256(arr: np.ndarray) -> str:
    h = hashlib.sha256()
    h.update(arr.tobytes())
    h.update(str(arr.shape).encode())
    return h.hexdigest()


def sha256_text(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write_png(path: Path, image) -> None:
    """Write PNG via temp + rename so mid-crash never leaves half files."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.png")
    image.save(tmp, format="PNG")
    tmp.replace(path)


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".avif"}


def list_images(folder: Path) -> tuple[list[Path], list[Path]]:
    accepted: list[Path] = []
    rejected: list[Path] = []
    for p in sorted(folder.iterdir(), key=lambda x: natural_key(x.name)):
        if not p.is_file():
            continue
        if p.suffix.lower() in IMAGE_EXTS:
            accepted.append(p)
        elif p.name.startswith("."):
            continue
        else:
            rejected.append(p)
    return accepted, rejected


def detect_script(text: str) -> str:
    if not text or not text.strip():
        return "none"
    letters = [c for c in text if c.isalpha() or "\u0900" <= c <= "\u097f" or "\uac00" <= c <= "\ud7af"]
    if not letters:
        return "none"
    n = len(letters)
    deva = sum(1 for c in letters if "\u0900" <= c <= "\u097f") / n
    hang = sum(1 for c in letters if "\uac00" <= c <= "\ud7af" or "\u1100" <= c <= "\u11ff") / n
    jpan = sum(
        1
        for c in letters
        if "\u3040" <= c <= "\u30ff" or "\u4e00" <= c <= "\u9fff"
    ) / n
    latn = sum(1 for c in letters if ("A" <= c <= "Z") or ("a" <= c <= "z")) / n
    if deva >= 0.6:
        return "deva"
    if hang >= 0.4:
        return "hang"
    if jpan >= 0.4:
        return "jpan"
    if latn >= 0.6:
        return "latn"
    return "mixed"


def count_words_hi(md: str) -> int:
    body = re.sub(r"^#+\s.*$", "", md, flags=re.M)
    body = re.sub(r"^\s*◆\s*$", "", body, flags=re.M)
    return len([w for w in re.split(r"\s+", body) if w.strip()])


def compact_bible(bible: dict, chapter_character_ids: Iterable[str] | None = None) -> dict:
    """Strip refs and long descs; optionally keep only characters in chapter."""
    import copy

    out = copy.deepcopy(bible)
    keep = set(chapter_character_ids) if chapter_character_ids else None
    chars = []
    for c in out.get("characters", []):
        if keep is not None and c.get("id") not in keep:
            continue
        c.pop("refs", None)
        vk = c.get("visual_key")
        if isinstance(vk, str) and len(vk) > 200:
            c["visual_key"] = vk[:200]
        chars.append(c)
    out["characters"] = chars
    return out
