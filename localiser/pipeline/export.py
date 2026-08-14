"""Export deliverables + QA report."""

from __future__ import annotations

import html
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from localiser.db import Chapter, Page, Region, Series
from localiser.pipeline.bible import load_bible
from localiser.pipeline.clean import BudgetViolation, verify_change_budget
from localiser.util import log, read_json, write_json
from localiser.util.paths import chapter_dir, output_dir, page_dir, series_dir


def export_blockers(db: Session, series_id: str) -> list[dict]:
    blockers = []
    series = db.get(Series, series_id)
    if not series:
        return [{"code": "missing_series", "msg": "Series not found"}]
    if series.rights_status == "internal_test":
        blockers.append(
            {
                "code": "rights_internal",
                "msg": "rights_status is internal_test — confirm before publishing",
                "soft": True,
            }
        )
    chapters = db.query(Chapter).filter(Chapter.series_id == series_id).order_by(Chapter.number).all()
    for ch in chapters:
        if (ch.story_words or 0) < 2000 and ch.state not in ("new", "analyzed"):
            blockers.append(
                {
                    "code": "story_short",
                    "msg": f"Chapter {ch.number} story has {ch.story_words} words (<2000)",
                    "chapter_id": ch.id,
                }
            )
        pages = db.query(Page).filter(Page.chapter_id == ch.id).all()
        for p in pages:
            if p.flagged:
                blockers.append(
                    {
                        "code": "flagged_page",
                        "msg": f"Page {p.id} is flagged",
                        "page_id": p.id,
                    }
                )
            pdir = page_dir(series_id, ch.number, p.index_in_ch)
            if (pdir / "composite.png").exists() and (pdir / "masks" / "budget.png").exists():
                try:
                    verify_change_budget(pdir)
                except BudgetViolation as e:
                    blockers.append(
                        {
                            "code": "budget_violation",
                            "msg": str(e),
                            "page_id": p.id,
                        }
                    )
            open_flags = (
                db.query(Region)
                .filter(Region.page_id == p.id, Region.status == "flagged")
                .count()
            )
            if open_flags:
                blockers.append(
                    {
                        "code": "flagged_regions",
                        "msg": f"{open_flags} flagged regions on {p.id}",
                        "page_id": p.id,
                    }
                )
    return blockers


def export_series(
    db: Session,
    series_id: str,
    *,
    include_story: bool = True,
    include_bible: bool = True,
    include_qa: bool = True,
    override_blockers: bool = False,
) -> Path:
    series = db.get(Series, series_id)
    if not series:
        raise ValueError("series not found")

    blockers = [b for b in export_blockers(db, series_id) if not b.get("soft")]
    hard = [b for b in blockers if b.get("code") == "budget_violation"]
    if hard:
        raise RuntimeError(f"Export refused: budget violations: {hard}")
    if blockers and not override_blockers:
        raise RuntimeError(f"Export blocked: {blockers[:5]}")

    out = output_dir(series.title)
    chapters = (
        db.query(Chapter).filter(Chapter.series_id == series_id).order_by(Chapter.number).all()
    )

    qa_rows = []
    for ch in chapters:
        folder_name = ch.title_src or f"Chapter {int(ch.number):02d}"
        # normalize Chapter XX
        if not folder_name.lower().startswith("chapter"):
            num = ch.number
            folder_name = f"Chapter {int(num):02d}" if num == int(num) else f"Chapter {num}"
        ch_out = out / folder_name
        ch_out.mkdir(parents=True, exist_ok=True)
        pages = (
            db.query(Page)
            .filter(Page.chapter_id == ch.id)
            .order_by(Page.index_in_ch)
            .all()
        )
        for p in pages:
            pdir = page_dir(series_id, ch.number, p.index_in_ch)
            src = pdir / "composite.png"
            if not src.exists():
                src = pdir / "original.png"
            # verify budget if composite
            if (pdir / "composite.png").exists():
                verify_change_budget(pdir)
            dest = ch_out / f"{p.index_in_ch:03d}.png"
            shutil.copy2(src, dest)
            qa_rows.append(
                {
                    "page_id": p.id,
                    "state": p.state,
                    "flagged": bool(p.flagged),
                    "version": p.version,
                }
            )

        if include_story:
            story = chapter_dir(series_id, ch.number) / "story.md"
            if story.exists():
                story_dir = out / "_story"
                story_dir.mkdir(exist_ok=True)
                num = ch.number
                name = f"chapter-{int(num):02d}.md" if num == int(num) else f"chapter-{num}.md"
                shutil.copy2(story, story_dir / name)

        ch.state = "exported"
    db.commit()

    if include_bible:
        bible = load_bible(series_id)
        if bible:
            bdir = out / "_bible"
            bdir.mkdir(exist_ok=True)
            write_json(bdir / "bible.json", bible)

    if include_qa:
        qa_dir = out / "_qa"
        qa_dir.mkdir(exist_ok=True)
        report = [
            "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Localiser QA</title>",
            "<style>body{font-family:sans-serif;background:#FBF8F1;color:#141210}",
            "table{border-collapse:collapse;width:100%}td,th{border:1px solid #D8D2C6;padding:6px}</style>",
            f"</head><body><h1>Localiser QA — {html.escape(series.title)}</h1>",
            f"<p>Rights: {html.escape(series.rights_status)}</p><table><tr><th>Page</th><th>State</th><th>Flagged</th><th>Ver</th></tr>",
        ]
        for r in qa_rows:
            report.append(
                f"<tr><td>{html.escape(r['page_id'])}</td><td>{r['state']}</td>"
                f"<td>{'yes' if r['flagged'] else ''}</td><td>{r['version']}</td></tr>"
            )
        report.append("</table></body></html>")
        (qa_dir / "report.html").write_text("\n".join(report), encoding="utf-8")

    log.info("export_complete", series_id=series_id, path=str(out))
    return out
