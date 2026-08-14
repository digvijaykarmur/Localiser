"""Stage 6 — "Make in Hindi": dialogue localization per utterance (§6, §10.8).

Refuses to run while the Bible is unlocked (the approval gate).
"""
from __future__ import annotations

import json
import re

import structlog

from ..ai import vertex
from ..config import SeriesConfig
from ..db import Region, PageRow, session
from .bible import compact_bible, load_bible, require_locked
from .consistency import TM, enforce_glossary, enforce_names, register_violations

log = structlog.get_logger()


def _register_for(bible: dict, speaker_id: str | None, default_register: str) -> dict:
    char = next((c for c in bible.get("characters", []) if c.get("id") == speaker_id), None)
    rid = (char or {}).get("register") or default_register
    reg = (bible.get("registers") or {}).get(rid) or {}
    return {"id": rid, "desc": reg.get("desc", ""), "rules": reg.get("rules", []),
            "avoid": reg.get("avoid", []), "char": char or {}}


def _max_chars_for(region: Region) -> int:
    """Character budget estimate from bubble area (refined at typeset time)."""
    x, y, w, h = json.loads(region.bbox)
    return max(20, int(w * h / 900))


def split_utterance(text: str, shares: list[float]) -> list[str]:
    """§8.5 — split at sentence/clause boundary nearest cumulative share point."""
    if len(shares) == 1:
        return [text]
    # candidate break points, by priority: । then ?/! then , then space
    breaks: list[tuple[int, int]] = []
    for priority, pattern in ((0, r"।"), (1, r"[?!]"), (2, r","), (3, r"\s")):
        for m in re.finditer(pattern, text):
            breaks.append((m.end(), priority))
    breaks.sort()
    out, start, cum = [], 0, 0.0
    for share in shares[:-1]:
        cum += share
        target = int(cum * len(text))
        best, best_cost = None, None
        for pos, priority in breaks:
            if pos <= start:
                continue
            cost = abs(pos - target) + priority * len(text) * 0.05
            if best_cost is None or cost < best_cost:
                best, best_cost = pos, cost
        if best is None:
            best = target
        out.append(text[start:best].strip())
        start = best
    out.append(text[start:].strip())
    return out


async def translate_page(page_id: str, scfg: SeriesConfig, job_id: str | None = None,
                         hint: str | None = None, only_region_ids: list[str] | None = None) -> None:
    require_locked(scfg.id)
    bible = load_bible(scfg.id)
    glossary = bible.get("glossary", [])
    tm = TM(scfg.id)
    frozen_names = ", ".join(f"{c.get('name_src')}→{c.get('name_hi')}"
                             for c in bible.get("characters", []) if c.get("name_hi"))

    with session() as s:
        regions = (s.query(Region).filter(Region.page_id == page_id)
                   .order_by(Region.ordinal).all())

    # skip inert regions: deva-gated, credits, empty, sfx unless enabled, locked
    def eligible(r: Region) -> bool:
        if only_region_ids and r.id not in only_region_ids:
            return False
        if r.src_script == "deva" or r.status == "approved" and not only_region_ids:
            return False
        if r.kind == "credit" or not (r.src_text or "").strip():
            return False
        if r.kind == "sfx" and not scfg.clean.include_sfx:
            return False
        if r.target_locked and not only_region_ids:
            return False
        return True

    work = [r for r in regions if eligible(r)]
    context_lines = [f"{r.speaker_id or '?'}: {r.src_text}" for r in regions if r.src_text]

    # group per utterance
    utterances: dict[str, list[Region]] = {}
    for r in work:
        utterances.setdefault(r.utterance_id or r.id, []).append(r)

    try:
        for utt_id, members in utterances.items():
            members.sort(key=lambda r: r.ordinal)
            src = "\n".join((m.src_text or "") for m in members).strip()
            lead = members[0]
            reg = _register_for(bible, lead.speaker_id, scfg.register_default)
            max_chars = sum(_max_chars_for(m) for m in members)

            lut = tm.lookup(src, lead.speaker_id, lead.kind, reg["id"])
            target: str | None = None
            tm_block = ""
            if lut["type"] == "exact" and not hint:
                target = lut["target_hi"]  # NN-4: reuse verbatim, no model call
            elif lut["type"] == "fuzzy":
                tm_block = (f"पहले यही लाइन ({lut.get('other_speaker')}) के लिए ऐसे हुई थी:\n"
                            f"{lut['target_hi']}\nWording consistent रखिए, सिर्फ़ register adjust कीजिए।")
            elif lut["type"] == "near":
                tm_block = f"Style anchor (मिलती-जुलती लाइन का अनुवाद): {lut['target_hi']}"

            if target is None:
                idx = context_lines.index(f"{lead.speaker_id or '?'}: {lead.src_text}") \
                    if f"{lead.speaker_id or '?'}: {lead.src_text}" in context_lines else 0
                window = "\n".join(context_lines[max(0, idx - 3): idx + 4])
                gsub = [t for t in glossary
                        if t.get("src", "").lower() in src.lower()][:12]
                prompt = vertex.load_prompt(
                    "p_dialogue",
                    src_text=src,
                    speaker_name_hi=reg["char"].get("name_hi", "अज्ञात"),
                    role=reg["char"].get("role", ""),
                    register_id=reg["id"], register_desc=reg["desc"],
                    speech_rules=json.dumps(reg["char"].get("speech_rules", []) or reg["rules"], ensure_ascii=False),
                    register_avoid=json.dumps(reg["avoid"], ensure_ascii=False),
                    context_window=window,
                    glossary_subset=json.dumps(gsub, ensure_ascii=False),
                    tm_reference_block=tm_block + (f"\nUser hint: {hint}" if hint else ""),
                    max_chars=max_chars, frozen_names=frozen_names,
                )
                data = await vertex.generate(prompt, model=scfg.models["dialogue"],
                                             purpose="dialogue", job_id=job_id)
                target = (data.get("text") or "").strip()

                # Layer 5: register guard with one auto-repair
                v = register_violations(target, {**reg, "id": reg["id"]})
                if v:
                    repair_prompt = prompt + (
                        "\n\nपिछला जवाब इन नियमों से टकराया: "
                        + json.dumps(v, ensure_ascii=False)
                        + "\nइन्हें ठीक करके दोबारा लिखिए।")
                    data = await vertex.generate(repair_prompt, model=scfg.models["dialogue"],
                                                 purpose="dialogue", job_id=job_id, use_cache=False)
                    target = (data.get("text") or target).strip()
                    v2 = register_violations(target, {**reg, "id": reg["id"]})
                    if v2:
                        with session() as s:
                            for m in members:
                                s.get(Region, m.id).status = "flagged"
                        log.warning("register_violation_flagged", utt=utt_id, v=v2)

            # Layers 3 + 4: deterministic post-passes
            target = enforce_glossary(target, glossary)
            target = enforce_names(target, bible)

            tm.store(src, lead.speaker_id, lead.kind, reg["id"], target, lead.id)

            # split across connected bubbles by area share (§8.5)
            areas = []
            for m in members:
                x, y, w, h = json.loads(m.bbox)
                areas.append(w * h)
            total = sum(areas) or 1
            pieces = split_utterance(target, [a / total for a in areas])
            with session() as s:
                for m, piece in zip(members, pieces):
                    row = s.get(Region, m.id)
                    if row.target_locked:
                        continue
                    row.target_text = piece
                    if row.status != "flagged":
                        row.status = "translated"
    finally:
        tm.close()

    with session() as s:
        page = s.get(PageRow, page_id)
        if page and page.state in ("analyzed", "new"):
            page.state = "translated"
