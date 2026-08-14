from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from localiser.db import get_db
from localiser.patch.engine import apply_ops, parse_chat_intent, revert_op
from localiser.schemas import ChatRequest

router = APIRouter(tags=["chat"])


@router.post("/chat")
async def chat(body: ChatRequest, db: Session = Depends(get_db)):
    try:
        result = await parse_chat_intent(
            scope=body.scope,
            scope_id=body.scope_id,
            message=body.message,
            selected_region_id=body.selected_region_id,
            db=db,
        )
    except Exception as e:
        raise HTTPException(503, f"Intent parse failed: {e}") from e
    return result


@router.post("/ops/apply")
def ops_apply(body: dict, db: Session = Depends(get_db)):
    ops = body.get("ops") or []
    applied = apply_ops(db, ops, source=body.get("source", "chat"))
    return {"applied": [a.id for a in applied]}


@router.post("/ops/{op_id}/revert")
def ops_revert(op_id: str, db: Session = Depends(get_db)):
    revert_op(db, op_id)
    return {"ok": True}
