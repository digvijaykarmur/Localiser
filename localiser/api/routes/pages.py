from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from PIL import Image
from sqlalchemy.orm import Session

from localiser.db import Chapter, Note, Page, Region, get_db, utcnow
from localiser.pipeline.clean import compose_page
from localiser.pipeline.typeset import typeset_page
from localiser.schemas import NoteCreate, RegionPatch
from localiser.util import new_id
from localiser.util.paths import page_dir

router = APIRouter(tags=["pages"])


def _page_paths(db: Session, page: Page) -> Path:
    ch = db.get(Chapter, page.chapter_id)
    if not ch:
        raise HTTPException(404, "Chapter missing")
    return page_dir(ch.series_id, ch.number, page.index_in_ch)


@router.get("/pages/{page_id:path}")
def get_page(page_id: str, db: Session = Depends(get_db)):
    # FastAPI path may need encoding — ids contain slashes
    page = db.get(Page, page_id)
    if not page:
        raise HTTPException(404, "Page not found")
    regions = (
        db.query(Region).filter(Region.page_id == page_id).order_by(Region.ordinal).all()
    )
    pdir = _page_paths(db, page)
    analysis = {}
    ap = pdir / "analysis.json"
    if ap.exists():
        analysis = json.loads(ap.read_text(encoding="utf-8"))
    return {
        "id": page.id,
        "chapter_id": page.chapter_id,
        "index": page.index_in_ch,
        "state": page.state,
        "version": page.version,
        "flagged": bool(page.flagged),
        "width": page.width,
        "height": page.height,
        "analysis": analysis,
        "regions": [
            {
                "id": r.id,
                "ordinal": r.ordinal,
                "kind": r.kind,
                "bbox": json.loads(r.bbox),
                "polygon": json.loads(r.polygon) if r.polygon else None,
                "src_text": r.src_text,
                "src_script": r.src_script,
                "target_text": r.target_text,
                "target_locked": bool(r.target_locked),
                "speaker_id": r.speaker_id,
                "status": r.status,
                "confidence": r.confidence,
                "source": r.source,
                "render": json.loads(r.render_json) if r.render_json else None,
            }
            for r in regions
        ],
    }


@router.get("/pages/{page_id:path}/image/{kind}")
def get_image(page_id: str, kind: str, db: Session = Depends(get_db)):
    page = db.get(Page, page_id)
    if not page:
        raise HTTPException(404)
    pdir = _page_paths(db, page)
    mapping = {
        "original": pdir / "original.png",
        "cleaned": pdir / "clean_layer.png",
        "composite": pdir / "composite.png",
        "budget": pdir / "masks" / "budget.png",
        "text": pdir / "text_layer.png",
    }
    if kind == "diff":
        orig = Image.open(pdir / "original.png").convert("RGBA")
        comp_path = pdir / "composite.png"
        if not comp_path.exists():
            raise HTTPException(404, "No composite yet")
        comp = Image.open(comp_path).convert("RGBA")
        a = np.array(orig)
        b = np.array(comp)
        diff = np.zeros_like(a)
        changed = np.any(a != b, axis=2)
        diff[changed] = [200, 40, 40, 180]
        from io import BytesIO

        buf = BytesIO()
        Image.fromarray(diff).save(buf, format="PNG")
        return Response(buf.getvalue(), media_type="image/png")

    path = mapping.get(kind)
    if not path or not path.exists():
        # cleaned view = original with clean applied for preview convenience
        if kind == "cleaned" and (pdir / "original.png").exists():
            path = pdir / "original.png"
        else:
            raise HTTPException(404, f"Image {kind} not found")
    return FileResponse(path, media_type="image/png")


@router.patch("/regions/{region_id:path}")
def patch_region(region_id: str, body: RegionPatch, db: Session = Depends(get_db)):
    reg = db.get(Region, region_id)
    if not reg:
        raise HTTPException(404)
    if body.target_text is not None:
        reg.target_text = body.target_text
    if body.locked is not None:
        reg.target_locked = 1 if body.locked else 0
    if body.speaker_id is not None:
        reg.speaker_id = body.speaker_id
    if body.font_px is not None:
        render = json.loads(reg.render_json or "{}")
        render["size"] = body.font_px
        reg.render_json = json.dumps(render)
    db.commit()
    return {"ok": True, "id": reg.id}


@router.post("/pages/{page_id:path}/rebuild")
async def rebuild(page_id: str, db: Session = Depends(get_db)):
    page = db.get(Page, page_id)
    if not page:
        raise HTTPException(404)
    ch = db.get(Chapter, page.chapter_id)
    await typeset_page(db, page, series_id=ch.series_id, chapter_number=ch.number)
    compose_page(db, page, series_id=ch.series_id, chapter_number=ch.number)
    return {"ok": True, "version": page.version}


@router.post("/pages/{page_id:path}/approve")
def approve_page(page_id: str, db: Session = Depends(get_db)):
    page = db.get(Page, page_id)
    if not page:
        raise HTTPException(404)
    page.state = "approved"
    db.commit()
    return {"ok": True}


@router.get("/notes")
def list_notes(page_id: str, db: Session = Depends(get_db)):
    rows = db.query(Note).filter(Note.page_id == page_id).all()
    return [
        {
            "id": n.id,
            "page_id": n.page_id,
            "region_id": n.region_id,
            "x": n.x,
            "y": n.y,
            "body": n.body,
            "status": n.status,
        }
        for n in rows
    ]


@router.post("/notes")
def create_note(body: NoteCreate, db: Session = Depends(get_db)):
    n = Note(
        id=new_id(),
        page_id=body.page_id,
        region_id=body.region_id,
        x=body.x,
        y=body.y,
        body=body.body,
        status="open",
        created_at=utcnow(),
    )
    db.add(n)
    db.commit()
    return {"id": n.id}
