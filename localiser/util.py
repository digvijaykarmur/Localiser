"""Small deterministic helpers shared across the pipeline."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # webtoon strips can exceed the default bomb limit


def natural_key(name: str) -> list:
    """Natural sort key: '2' < '010', digit runs compared numerically (§5 Stage 0)."""
    parts = re.split(r"(\d+)", name)
    return [int(p) if p.isdigit() else p.lower() for p in parts]


def parse_chapter_number(folder_name: str) -> float | None:
    """Regex chain from §Stage 0 step 2; supports decimal chapters (10.5)."""
    for pattern in (r"(?:ch(?:apter)?[\s._-]*)(\d+(?:\.\d+)?)", r"^(\d+(?:\.\d+)?)"):
        m = re.search(pattern, folder_name, flags=re.IGNORECASE)
        if m:
            return float(m.group(1))
    return None


def pixel_sha256(img: Image.Image) -> str:
    """Hash of the decoded pixel array, not file bytes (dedup survives re-encode)."""
    arr = np.asarray(img.convert("RGBA"))
    return hashlib.sha256(arr.tobytes()).hexdigest()


def load_original_rgb(path: Path) -> Image.Image:
    """Decode any accepted format; CMYK/ICC → sRGB once (edge case #21);
    transparent PNG composited onto white for analysis (edge case #22)."""
    img = Image.open(path)
    if img.mode == "CMYK":
        img = img.convert("RGB")
    if img.mode in ("RGBA", "LA", "PA"):
        return img.convert("RGBA")
    return img.convert("RGB")


def atomic_save_png(img: Image.Image, path: Path) -> None:
    """Atomic PNG write (tmp + rename) — edge case #23."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.png")
    img.save(tmp, format="PNG")
    tmp.replace(path)


# --- script detection (§Stage 2 step 3) -----------------------------------

_RANGES = {
    "deva": [(0x0900, 0x097F)],
    "hang": [(0xAC00, 0xD7AF), (0x1100, 0x11FF), (0x3130, 0x318F)],
    "jpan": [(0x3040, 0x309F), (0x30A0, 0x30FF), (0x4E00, 0x9FFF), (0x3400, 0x4DBF)],
    "latn": [(0x0041, 0x005A), (0x0061, 0x007A)],
}


def detect_script(text: str) -> str:
    letters = [c for c in text if c.isalpha() or 0x3040 <= ord(c) <= 0x9FFF]
    if not letters:
        return "none"
    counts = {k: 0 for k in _RANGES}
    for c in letters:
        cp = ord(c)
        for script, ranges in _RANGES.items():
            if any(lo <= cp <= hi for lo, hi in ranges):
                counts[script] += 1
                break
    n = len(letters)
    if counts["deva"] / n >= 0.6:
        return "deva"
    if counts["hang"] / n >= 0.3:
        return "hang"
    if counts["jpan"] / n >= 0.3:
        return "jpan"
    if counts["latn"] / n >= 0.6:
        return "latn"
    return "mixed"


def latin_char_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if c.isascii()) / len(letters)


def count_words_hi(md: str) -> int:
    """Word count of a Hindi story markdown, headers/dividers stripped (§9.4)."""
    lines = []
    for line in md.splitlines():
        s = line.strip()
        if s.startswith("#") or s in {"◆", "***", "---"}:
            continue
        lines.append(s)
    body = " ".join(lines)
    return len([w for w in re.split(r"\s+", body) if w.strip()])


def ngram_overlap(a: str, b: str, n: int = 5) -> float:
    """5-gram overlap of b against a — repetition/padding detector (§9.4)."""
    def grams(t: str) -> set[tuple[str, ...]]:
        words = re.split(r"\s+", t.strip())
        return {tuple(words[i:i + n]) for i in range(max(0, len(words) - n + 1))}

    ga, gb = grams(a), grams(b)
    if not gb:
        return 0.0
    return len(ga & gb) / len(gb)


def levenshtein_ratio(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    dist = prev[-1]
    return 1.0 - dist / max(len(a), len(b))


def norm_src(text: str) -> str:
    """Normalised source line for TM keys: lowercased, punctuation collapsed."""
    t = text.lower().strip()
    t = re.sub(r"[\.\,\!\?\;\:\'\"\u2018\u2019\u201c\u201d…]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()
