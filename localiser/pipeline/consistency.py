"""Translation Memory + glossary + register + name enforcement (Consistency Engine)."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from pathlib import Path

from localiser.util.paths import tm_dir


def _norm_src(text: str) -> str:
    t = text.lower().strip()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"[^\w\s\u0900-\u097f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]", "", t)
    return t


def tm_key(norm_src: str, speaker_id: str | None, kind: str, register: str) -> str:
    raw = f"{norm_src}|{speaker_id or ''}|{kind}|{register}"
    return hashlib.sha1(raw.encode()).hexdigest()


class TranslationMemory:
    def __init__(self, series_id: str):
        self.path = tm_dir(series_id) / "tm.sqlite"
        self._init()

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        return c

    def _init(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS tm (
                  key TEXT PRIMARY KEY,
                  norm_src TEXT NOT NULL,
                  speaker_id TEXT, kind TEXT, register TEXT,
                  target_hi TEXT NOT NULL,
                  hit_count INTEGER DEFAULT 0,
                  first_seen TEXT,
                  user_locked INTEGER DEFAULT 0
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_tm_norm ON tm(norm_src)")

    def lookup(
        self, src: str, speaker_id: str | None, kind: str, register: str
    ) -> dict | None:
        norm = _norm_src(src)
        key = tm_key(norm, speaker_id, kind, register)
        with self._conn() as c:
            row = c.execute("SELECT * FROM tm WHERE key=?", (key,)).fetchone()
            if row:
                c.execute(
                    "UPDATE tm SET hit_count=hit_count+1 WHERE key=?", (key,)
                )
                return dict(row)
            # fuzzy: same norm, different speaker
            row = c.execute(
                "SELECT * FROM tm WHERE norm_src=? ORDER BY user_locked DESC, hit_count DESC LIMIT 1",
                (norm,),
            ).fetchone()
            if row:
                return {**dict(row), "fuzzy": True}
        return None

    def near_hits(self, src: str, threshold: float = 0.86) -> list[dict]:
        try:
            from Levenshtein import ratio
        except ImportError:
            return []
        norm = _norm_src(src)
        with self._conn() as c:
            rows = c.execute("SELECT * FROM tm LIMIT 5000").fetchall()
        out = []
        for r in rows:
            if ratio(norm, r["norm_src"]) > threshold:
                out.append(dict(r))
        return out[:5]

    def store(
        self,
        src: str,
        target_hi: str,
        speaker_id: str | None,
        kind: str,
        register: str,
        first_seen: str,
        user_locked: int = 0,
    ) -> None:
        norm = _norm_src(src)
        key = tm_key(norm, speaker_id, kind, register)
        with self._conn() as c:
            existing = c.execute("SELECT user_locked FROM tm WHERE key=?", (key,)).fetchone()
            if existing and existing["user_locked"] and not user_locked:
                return  # never overwrite user-locked
            c.execute(
                """
                INSERT INTO tm(key,norm_src,speaker_id,kind,register,target_hi,hit_count,first_seen,user_locked)
                VALUES(?,?,?,?,?,?,1,?,?)
                ON CONFLICT(key) DO UPDATE SET
                  target_hi=excluded.target_hi,
                  hit_count=tm.hit_count+1,
                  user_locked=MAX(tm.user_locked, excluded.user_locked)
                """,
                (key, norm, speaker_id, kind, register, target_hi, first_seen, user_locked),
            )


def load_glossary(series_id: str) -> list[dict]:
    path = tm_dir(series_id) / "glossary.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return []


def save_glossary(series_id: str, glossary: list[dict]) -> None:
    path = tm_dir(series_id) / "glossary.json"
    path.write_text(json.dumps(glossary, ensure_ascii=False, indent=2), encoding="utf-8")


def apply_glossary(text: str, glossary: list[dict]) -> str:
    # longest src first
    terms = sorted(glossary, key=lambda g: len(g.get("src", "")), reverse=True)
    for term in terms:
        src = term.get("src") or ""
        hi = term.get("hi") or ""
        if not src or not hi:
            continue
        for variant in _variants(src):
            text = re.sub(re.escape(variant), hi, text, flags=re.IGNORECASE)
        for wrong in term.get("known_wrong_hi", []) or []:
            text = text.replace(wrong, hi)
    return text


def _variants(src: str) -> list[str]:
    out = {src, src.lower(), src.upper(), src.title(), src.replace(" ", "")}
    if not src.endswith("s"):
        out.add(src + "s")
    return list(out)


def apply_name_policy(text: str, bible: dict) -> str:
    chars = bible.get("characters", []) + bible.get("entities", []) + bible.get("places", [])
    # longest names first
    pairs = []
    for c in chars:
        src = c.get("name_src") or c.get("name") or ""
        hi = c.get("name_hi") or ""
        if src and hi:
            pairs.append((src, hi))
        for a in c.get("aliases_src", []) or []:
            if hi:
                pairs.append((a, hi))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    for src, hi in pairs:
        text = re.sub(re.escape(src), hi, text, flags=re.IGNORECASE)
    return text


def register_violations(text: str, register: dict | None, register_id: str) -> list[tuple[str, str]]:
    v: list[tuple[str, str]] = []
    if not register:
        register = {}
    for bad in register.get("avoid", []) or []:
        if bad and bad in text:
            v.append(("avoid", bad))
    if register_id in ("urban_hinglish_high", "urban_hinglish"):
        if re.search(r"(परन्तु|अत्यंत|तथा|एवं|किन्तु)", text):
            v.append(("too_formal", "literary"))
        latin = sum(1 for c in text if "A" <= c <= "Z" or "a" <= c <= "z")
        letters = sum(1 for c in text if c.isalpha() or "\u0900" <= c <= "\u097f") or 1
        if latin / letters > 0.05:
            v.append(("latin_leak", "latin"))
    if register_id == "formal_polite":
        if re.search(r"(तू|तेरा|अबे|यार)", text):
            v.append(("too_casual", "casual"))
    if any(ch in text for ch in "。、「」〜"):
        v.append(("cjk_punct", "cjk"))
    return v


def latin_char_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha() or "\u0900" <= c <= "\u097f"]
    if not letters:
        return 0.0
    latin = sum(1 for c in letters if "A" <= c <= "Z" or "a" <= c <= "z")
    return latin / len(letters)
