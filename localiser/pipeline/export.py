"""Export — writes output/<Title>/Chapter NN/*.png + stories + bible + QA report.

Refuses to run with blockers unless explicitly overridden (§S6). The pixel
budget assertion is re-verified on every page at export time (§7.6).
"""
from __future__ import annotations

import html
import json
import shutil
from pathlib import Path

import structlog

from ..config import CFG, SeriesConfig
from ..db import Chapter, PageRow, Region, Series, session
from .budget import BudgetViolation, verify_change_budget
from .bible import bible_current_path
from .paths import chapter_dir_from_id, page_paths

log = structlog.get_logger()


def export_blockers(series_id: str) -> list[dict]:
    blockers: list[dict] = []
    with session() as s:
        srs = s.get(Series, series_id)
        chapters = s.query(Chapter).filter(Chapter.series_id == series_id).all()
        for ch in chapters:
            if 0 < ch.story_words < 2000:
                blockers.append({"kind": "story_short", "chapter": ch.id,
                                 "detail": f"{ch.story_words} words < 2000"})
            pages = s.query(PageRow).filter(PageRow.chapter_id == ch.id).all()
            for p in pages:
                if p.state == "error":
                    blockers.append({"kind": "page_error", "page": p.id})
                flags = (s.query(Region)
                         .filter(Region.page_id == p.id, Region.status == "flagged").count())
                if flags:
                    blockers.append({"kind": "open_flags", "page": p.id, "detail": f"{flags} flagged"})
        if srs and srs.rights_status == "internal_test":
            blockers.append({"kind": "rights", "detail":
                             "rights_status=internal_test — confirm adaptation rights before publishing"})
    return blockers


def export_series(scfg: SeriesConfig, options: dict | None = None) -> dict:
    options = options or {}
    override = bool(options.get("override_blockers"))
    blockers = export_blockers(scfg.id)
    hard = [b for b in blockers if b["kind"] in ("page_error",)]
    if blockers and not override:
        return {"status": "blocked", "blockers": blockers}
    if hard:
        return {"status": "blocked", "blockers": hard}

    out_root = CFG.output_dir / scfg.title
    include_story = options.get("include_story", True)
    include_bible = options.get("include_bible", True)
    report_rows: list[dict] = []

    with session() as s:
        chapters = (s.query(Chapter).filter(Chapter.series_id == scfg.id)
                    .order_by(Chapter.number).all())
        for ch in chapters:
            n = ch.number
            ch_name = f"Chapter {int(n):02d}" if n == int(n) else f"Chapter {n:g}"
            ch_out = out_root / ch_name
            ch_out.mkdir(parents=True, exist_ok=True)
            pages = (s.query(PageRow).filter(PageRow.chapter_id == ch.id)
                     .order_by(PageRow.index_in_ch).all())
            for p in pages:
                pp = page_paths(p.id)
                src = pp["composite"] if pp["composite"].exists() else pp["original"]
                if pp["composite"].exists():
                    try:
                        verify_change_budget(pp["dir"])  # export-path re-verify
                    except BudgetViolation as e:
                        return {"status": "blocked", "blockers": [
                            {"kind": "budget_violation", "page": p.id, "detail": str(e)}]}
                if src.exists():
                    shutil.copyfile(src, ch_out / f"{p.index_in_ch:03d}.png")
                report_rows.append({"page": p.id, "state": p.state,
                                    "flagged": bool(p.flagged)})
            if include_story:
                story = chapter_dir_from_id(ch.id) / "story.md"
                if story.exists():
                    story_dir = out_root / "_story"
                    story_dir.mkdir(exist_ok=True)
                    shutil.copyfile(story, story_dir / f"chapter-{n:g}.md")

    if include_bible:
        bp = bible_current_path(scfg.id)
        if bp:
            bdir = out_root / "_bible"
            bdir.mkdir(exist_ok=True)
            shutil.copyfile(bp, bdir / "bible.json")

    qa_dir = out_root / "_qa"
    qa_dir.mkdir(exist_ok=True)
    (qa_dir / "report.html").write_text(_qa_html(scfg, report_rows, blockers), encoding="utf-8")
    return {"status": "done", "path": str(out_root), "pages": len(report_rows),
            "overridden_blockers": blockers if override else []}


def _qa_html(scfg: SeriesConfig, rows: list[dict], blockers: list[dict]) -> str:
    trs = "\n".join(
        f"<tr><td>{html.escape(r['page'])}</td><td>{html.escape(r['state'])}</td>"
        f"<td>{'⚑' if r['flagged'] else ''}</td></tr>" for r in rows)
    bl = "\n".join(f"<li><b>{html.escape(b['kind'])}</b> — "
                   f"{html.escape(str(b.get('detail') or b.get('page') or b.get('chapter') or ''))}</li>"
                   for b in blockers) or "<li>none</li>"
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>QA — {html.escape(scfg.title)}</title>
<style>body{{font-family:sans-serif;background:#FBF8F1;color:#141210;max-width:60rem;margin:2rem auto}}
table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #D8D2C6;padding:4px 8px;text-align:left}}
</style></head><body>
<h1>QA Report — {html.escape(scfg.title)}</h1>
<p>rights_status: <b>{scfg.rights_status}</b></p>
<h2>Flags &amp; blockers</h2><ul>{bl}</ul>
<h2>Pages</h2><table><tr><th>page</th><th>state</th><th>flag</th></tr>{trs}</table>
</body></html>"""
