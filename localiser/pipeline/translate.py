"""Dialogue localization — Make in Hindi (TM + glossary + register guard)."""

from __future__ import annotations

import json
from collections import defaultdict

from sqlalchemy.orm import Session

from localiser.ai import vertex
from localiser.db import Chapter, Page, Region, Series
from localiser.pipeline.bible import load_bible
from localiser.pipeline.consistency import (
    TranslationMemory,
    apply_glossary,
    apply_name_policy,
    load_glossary,
    register_violations,
    save_glossary,
)
from localiser.pipeline.group import group_utterances, split_utterance_text
from localiser.util import compact_bible, log


def _prompt(name: str) -> str:
    from localiser.config import get_settings

    return (get_settings().prompts_dir / name).read_text(encoding="utf-8")


def _require_bible_locked(series: Series) -> dict:
    if not series.bible_locked:
        raise RuntimeError(
            "Bible is not locked. Lock the Series Bible before translate/story stages."
        )
    bible = load_bible(series.id)
    if not bible:
        raise RuntimeError("Locked bible file missing")
    return bible


async def translate_chapter(
    db: Session,
    series: Series,
    chapter: Chapter,
    *,
    job_id: str | None = None,
) -> None:
    bible = _require_bible_locked(series)
    glossary = load_glossary(series.id)
    if not glossary and bible.get("glossary"):
        glossary = bible["glossary"]
        save_glossary(series.id, glossary)

    tm = TranslationMemory(series.id)
    char_by_id = {c["id"]: c for c in bible.get("characters", [])}
    registers = bible.get("registers", {})
    default_reg = series_config_register(series)

    pages = (
        db.query(Page)
        .filter(Page.chapter_id == chapter.id, Page.skip_processing == 0)
        .order_by(Page.index_in_ch)
        .all()
    )

    for page in pages:
        group_utterances(db, page.id)
        regions = (
            db.query(Region)
            .filter(Region.page_id == page.id)
            .order_by(Region.ordinal)
            .all()
        )

        # Build utterance groups
        by_utt: dict[str, list[Region]] = defaultdict(list)
        for r in regions:
            if r.src_script == "deva":
                continue
            if r.kind in ("credit",):
                continue
            if r.kind == "sfx":
                # map via sfx_map for story; images default skip
                continue
            if not r.src_text:
                continue
            if r.target_locked:
                continue
            by_utt[r.utterance_id or r.id].append(r)

        # context window of targets/src
        all_ordered = regions
        for utt_id, members in by_utt.items():
            members = sorted(members, key=lambda r: r.ordinal)
            src = "\n".join(m.src_text or "" for m in members)
            speaker_id = next((m.speaker_id for m in members if m.speaker_id), None)
            kind = members[0].kind
            char = char_by_id.get(speaker_id or "", {})
            register_id = char.get("register") or default_reg
            register = registers.get(register_id, {})

            hit = tm.lookup(src, speaker_id, kind, register_id)
            if hit and not hit.get("fuzzy"):
                hindi = hit["target_hi"]
            else:
                # context
                ctx_lines = []
                for r in all_ordered:
                    if abs(r.ordinal - members[0].ordinal) <= 3:
                        ctx_lines.append(
                            f"{r.ordinal}. [{r.speaker_id or '?'}] {r.src_text} → {r.target_text or ''}"
                        )
                tm_block = ""
                if hit and hit.get("fuzzy"):
                    tm_block = (
                        f"Earlier translation of similar line: {hit['target_hi']}\n"
                        "Keep wording consistent; adjust only register for this speaker."
                    )
                near = tm.near_hits(src)
                if near:
                    tm_block += "\nStyle anchors:\n" + "\n".join(
                        f"- {n['norm_src']} → {n['target_hi']}" for n in near[:3]
                    )

                # rough char budget from bbox area
                areas = []
                for m in members:
                    b = json.loads(m.bbox)
                    areas.append(float(b[2] * b[3]))
                max_chars = max(24, int(sum(areas) ** 0.5 / 3))

                frozen_names = ", ".join(
                    f"{c.get('name_src', '')}→{c.get('name_hi', '')}"
                    for c in bible.get("characters", [])
                    if c.get("name_hi")
                )
                gloss_subset = json.dumps(glossary[:40], ensure_ascii=False)

                prompt = (
                    _prompt("P-DIALOGUE.txt")
                    .replace("{speaker_name_hi}", char.get("name_hi") or "अज्ञात")
                    .replace("{role}", char.get("role") or "unknown")
                    .replace("{register_id}", register_id)
                    .replace("{register_desc}", register.get("desc", ""))
                    .replace(
                        "{speech_rules}",
                        "\n".join(char.get("speech_rules") or register.get("rules") or []),
                    )
                    .replace(
                        "{register_avoid}",
                        ", ".join(register.get("avoid") or char.get("forbidden") or []),
                    )
                    .replace("{context_window}", "\n".join(ctx_lines))
                    .replace("{glossary_subset}", gloss_subset)
                    .replace("{tm_reference_block}", tm_block)
                    .replace("{max_chars}", str(max_chars))
                    .replace("{frozen_names}", frozen_names)
                )
                prompt += f"\n\nSOURCE:\n{src}"

                data = await vertex.generate(
                    purpose="dialogue",
                    prompt=prompt,
                    json_mode=True,
                    job_id=job_id,
                )
                hindi = (data.get("text") if isinstance(data, dict) else str(data)) or ""

                # post passes
                hindi = apply_glossary(hindi, glossary)
                hindi = apply_name_policy(hindi, bible)
                viol = register_violations(hindi, register, register_id)
                if viol:
                    repair = await vertex.generate(
                        purpose="dialogue",
                        prompt=prompt
                        + f"\n\nPrevious output had violations {viol}. Fix them.\nPrevious: {hindi}",
                        json_mode=True,
                        job_id=job_id,
                    )
                    hindi2 = (repair.get("text") if isinstance(repair, dict) else "") or hindi
                    hindi2 = apply_glossary(hindi2, glossary)
                    hindi2 = apply_name_policy(hindi2, bible)
                    if register_violations(hindi2, register, register_id):
                        for m in members:
                            m.status = "flagged"
                        page.flagged = 1
                    hindi = hindi2

                tm.store(src, hindi, speaker_id, kind, register_id, members[0].id)

            parts = split_utterance_text(hindi, areas if len(members) > 1 else [1.0])
            # ensure areas defined for single
            if len(members) == 1:
                parts = [hindi]
            for m, part in zip(members, parts):
                m.target_text = part
                m.status = "translated"

        page.state = "translated"
        db.commit()

    chapter.state = "pages_done" if chapter.state not in ("approved", "exported") else chapter.state
    db.commit()
    log.info("chapter_translated", chapter_id=chapter.id)


def series_config_register(series: Series) -> str:
    from localiser.util.paths import series_dir
    from localiser.util import read_json

    path = series_dir(series.id) / "series.json"
    if path.exists():
        cfg = read_json(path)
        return cfg.get("register_default", "urban_hinglish")
    return "urban_hinglish"
