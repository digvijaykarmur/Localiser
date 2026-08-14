from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from localiser.db import Job, LlmCall, get_db
from localiser.jobs.runner import events

router = APIRouter(tags=["jobs"])


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404)
    return {
        "id": job.id,
        "kind": job.kind,
        "scope_id": job.scope_id,
        "state": job.state,
        "progress": job.progress,
        "total": job.total,
        "completed": job.completed,
        "error": job.error,
    }


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    return StreamingResponse(events(job_id), media_type="text/event-stream")


@router.get("/cost")
def cost(series_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(LlmCall)
    rows = q.order_by(LlmCall.created_at.desc()).limit(5000).all()
    # crude pricing placeholders — user can update pricing.json
    from pathlib import Path
    import json

    pricing_path = Path(__file__).resolve().parents[3] / "pricing.json"
    pricing = (
        json.loads(pricing_path.read_text())
        if pricing_path.exists()
        else {"default_in": 0.000001, "default_out": 0.000005}
    )
    total = 0.0
    by_purpose: dict[str, float] = {}
    for r in rows:
        cost_r = (r.in_tokens or 0) * pricing.get("default_in", 0) + (
            r.out_tokens or 0
        ) * pricing.get("default_out", 0)
        total += cost_r
        by_purpose[r.purpose or "?"] = by_purpose.get(r.purpose or "?", 0) + cost_r
    return {
        "total_usd_est": total,
        "by_purpose": by_purpose,
        "calls": len(rows),
        "models_note": "Costs are estimates; update pricing.json for your Vertex rates.",
    }
