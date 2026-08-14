"""Consistency Engine — §6. Five layers:
1. Locked Bible (compacted into every prompt — see translate.py/story.py)
2. Translation Memory (tm.sqlite)
3. Glossary enforcement (deterministic post-pass)
4. Name policy (frozen transliteration post-pass)
5. Register guard (validator + one auto-repair)
"""
from __future__ import annotations

import hashlib
import re
import sqlite3
from pathlib import Path

import structlog

from ..util import latin_char_ratio, levenshtein_ratio, norm_src
from .paths import tm_dir

log = structlog.get_logger()


# --- Layer 2: Translation Memory (NN-4) --------------------------------------

class TM:
    def __init__(self, series_id: str):
        d = tm_dir(series_id)
        d.mkdir(parents=True, exist_ok=True)
        self.path = d / "tm.sqlite"
        self.con = sqlite3.connect(self.path)
        self.con.execute("""
            CREATE TABLE IF NOT EXISTS tm (
              key         TEXT PRIMARY KEY,
              norm_src    TEXT NOT NULL,
              speaker_id  TEXT, kind TEXT, register TEXT,
              target_hi   TEXT NOT NULL,
              hit_count   INTEGER DEFAULT 0,
              first_seen  TEXT,
              user_locked INTEGER DEFAULT 0
            )""")
        self.con.execute("CREATE INDEX IF NOT EXISTS idx_tm_norm ON tm(norm_src)")
        self.con.commit()

    @staticmethod
    def key(src: str, speaker_id: str | None, kind: str, register: str) -> str:
        raw = f"{norm_src(src)}|{speaker_id or ''}|{kind}|{register}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def lookup(self, src: str, speaker_id: str | None, kind: str, register: str) -> dict:
        """Returns {"type": exact|fuzzy|near|miss, ...} per §6.2 lookup order."""
        ns = norm_src(src)
        k = self.key(src, speaker_id, kind, register)
        cur = self.con.execute("SELECT target_hi, user_locked FROM tm WHERE key=?", (k,))
        row = cur.fetchone()
        if row:
            self.con.execute("UPDATE tm SET hit_count=hit_count+1 WHERE key=?", (k,))
            self.con.commit()
            return {"type": "exact", "target_hi": row[0], "user_locked": bool(row[1])}
        cur = self.con.execute(
            "SELECT target_hi, speaker_id FROM tm WHERE norm_src=? LIMIT 1", (ns,))
        row = cur.fetchone()
        if row:
            return {"type": "fuzzy", "target_hi": row[0], "other_speaker": row[1]}
        # near hit: Levenshtein > 0.86 on norm_src
        cur = self.con.execute("SELECT norm_src, target_hi FROM tm")
        best, best_ratio = None, 0.0
        for cand_ns, cand_hi in cur.fetchall():
            r = levenshtein_ratio(ns, cand_ns)
            if r > best_ratio:
                best, best_ratio = cand_hi, r
        if best is not None and best_ratio > 0.86:
            return {"type": "near", "target_hi": best, "ratio": best_ratio}
        return {"type": "miss"}

    def store(self, src: str, speaker_id: str | None, kind: str, register: str,
              target_hi: str, region_id: str, user_locked: bool = False) -> None:
        k = self.key(src, speaker_id, kind, register)
        cur = self.con.execute("SELECT user_locked FROM tm WHERE key=?", (k,))
        row = cur.fetchone()
        if row and row[0] and not user_locked:
            return  # locked entries never overwritten by generation
        self.con.execute(
            "INSERT INTO tm(key, norm_src, speaker_id, kind, register, target_hi, first_seen, user_locked)"
            " VALUES(?,?,?,?,?,?,?,?)"
            " ON CONFLICT(key) DO UPDATE SET target_hi=excluded.target_hi,"
            " user_locked=max(tm.user_locked, excluded.user_locked)",
            (k, norm_src(src), speaker_id, kind, register, target_hi, region_id,
             1 if user_locked else 0))
        self.con.commit()

    def occurrences(self, src: str) -> int:
        cur = self.con.execute("SELECT COUNT(*) FROM tm WHERE norm_src=?", (norm_src(src),))
        return cur.fetchone()[0]

    def close(self):
        self.con.close()


# --- Layer 3: Glossary enforcement (deterministic post-pass) -------------------

def _variants(src: str) -> list[str]:
    v = {src, src.lower(), src.upper(), src.title()}
    if not src.endswith("s"):
        v |= {src + "s", src.lower() + "s"}
    v |= {re.sub(r"\s+", "", x) for x in list(v)}
    return sorted(v, key=len, reverse=True)


def enforce_glossary(text: str, glossary: list[dict]) -> str:
    """Forced substitution after every generation (§6.3). Longest src first."""
    out = text
    for term in sorted(glossary, key=lambda t: -len(t.get("src", ""))):
        hi = term.get("hi")
        if not hi:
            continue
        for variant in _variants(term.get("src", "")):
            if not variant:
                continue
            out = re.sub(rf"(?<![\w]){re.escape(variant)}(?![\w])", hi, out)
        for wrong in term.get("known_wrong_hi", []) or []:
            if wrong and wrong != hi:
                out = out.replace(wrong, hi)
    return out


def learn_wrong_variant(glossary: list[dict], src: str, wrong_hi: str) -> None:
    """User corrected a term → record the drift so it self-heals (§6.3)."""
    for term in glossary:
        if term.get("src", "").lower() == src.lower():
            kw = term.setdefault("known_wrong_hi", [])
            if wrong_hi not in kw and wrong_hi != term.get("hi"):
                kw.append(wrong_hi)


# --- Layer 4: Name policy (NN-5) -----------------------------------------------

def enforce_names(text: str, bible: dict) -> str:
    """Replace any source-name occurrence with the frozen name_hi."""
    out = text
    for c in bible.get("characters", []):
        name_hi = c.get("name_hi")
        name_src = c.get("name_src")
        if not name_hi or not name_src:
            continue
        parts = [name_src] + name_src.split()
        for p in sorted(set(parts), key=len, reverse=True):
            if len(p) < 3:
                continue
            out = re.sub(rf"(?<![\w]){re.escape(p)}(?![\w])", name_hi, out, flags=re.IGNORECASE)
    return out


# --- Layer 5: Register guard -----------------------------------------------------

FORMAL_WORDS = r"(परन्तु|अत्यंत|तथा|एवं|किन्तु)"
CASUAL_WORDS = r"(?:^|[\s,!?।])(तू|तेरा|तेरी|अबे|यार)(?:$|[\s,!?।])"
CJK_PUNCT = "。、「」〜"


def register_violations(text: str, register: dict) -> list[tuple[str, str]]:
    v: list[tuple[str, str]] = []
    for bad in register.get("avoid", []) or []:
        if bad and bad in text:
            v.append(("avoid", bad))
    rid = register.get("id", "")
    if rid.startswith("urban_hinglish"):
        m = re.search(FORMAL_WORDS, text)
        if m:
            v.append(("too_formal", m.group(1)))
        if latin_char_ratio(text) > 0.05:
            v.append(("latin_leak", "English words must be in Devanagari"))
    if rid == "formal_polite":
        m = re.search(CASUAL_WORDS, text)
        if m:
            v.append(("too_casual", m.group(1)))
    if any(ch in text for ch in CJK_PUNCT):
        v.append(("cjk_punct", "CJK punctuation leaked"))
    return v
