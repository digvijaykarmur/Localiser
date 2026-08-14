"""Stage 3 — utterance grouping + speaker attribution helpers."""

from __future__ import annotations

import json
from collections import defaultdict

from sqlalchemy.orm import Session

from localiser.db import Region
from localiser.util import new_id


def group_utterances(db: Session, page_id: str) -> None:
    regions = (
        db.query(Region)
        .filter(Region.page_id == page_id)
        .order_by(Region.ordinal)
        .all()
    )
    dialogueish = [r for r in regions if r.kind in ("dialogue", "thought")]

    def bbox(r: Region) -> list[int]:
        return json.loads(r.bbox)

    assigned: dict[str, str] = {}
    for i, r1 in enumerate(dialogueish):
        if r1.id in assigned:
            continue
        uid = f"utt_{new_id()}"
        assigned[r1.id] = uid
        b1 = bbox(r1)
        for r2 in dialogueish[i + 1 :]:
            if r2.id in assigned:
                continue
            if r1.kind != r2.kind:
                continue
            b2 = bbox(r2)
            gap = abs(b2[1] - (b1[1] + b1[3])) if b2[1] >= b1[1] else abs(b1[1] - (b2[1] + b2[3]))
            if gap >= 0.4 * min(b1[3], b2[3]):
                # also allow horizontal adjacency
                hgap = abs(b2[0] - (b1[0] + b1[2])) if b2[0] >= b1[0] else abs(b1[0] - (b2[0] + b2[2]))
                if hgap >= 0.4 * min(b1[2], b2[2]):
                    continue
            # overlap checks
            h_overlap = max(0, min(b1[0] + b1[2], b2[0] + b2[2]) - max(b1[0], b2[0]))
            v_overlap = max(0, min(b1[1] + b1[3], b2[1] + b2[3]) - max(b1[1], b2[1]))
            h_ratio = h_overlap / max(1, min(b1[2], b2[2]))
            v_ratio = v_overlap / max(1, min(b1[3], b2[3]))
            if h_ratio > 0.35 or v_ratio > 0.35 or gap < 0.4 * min(b1[3], b2[3]):
                if abs(r1.ordinal - r2.ordinal) <= 2:
                    assigned[r2.id] = uid

    for r in regions:
        if r.id in assigned:
            r.utterance_id = assigned[r.id]
        elif r.kind in ("dialogue", "thought", "narration", "ui_window"):
            r.utterance_id = f"utt_{new_id()}"
    db.commit()


def split_utterance_text(text: str, areas: list[float]) -> list[str]:
    """Split Hindi text across connected bubbles by area share."""
    if len(areas) <= 1:
        return [text]
    total = sum(areas) or 1.0
    shares = [a / total for a in areas]
    # Prefer break at । ? ! , space
    breaks = []
    for i, ch in enumerate(text):
        if ch in "।?!," or ch == " ":
            breaks.append(i + 1)
    if not breaks:
        # equal char split without splitting words
        words = text.split(" ")
        n = len(areas)
        out = []
        idx = 0
        for s in shares[:-1]:
            target = int(round(s * len(words)))
            chunk = words[idx : idx + max(1, target)]
            out.append(" ".join(chunk))
            idx += len(chunk)
        out.append(" ".join(words[idx:]))
        return out

    targets = []
    acc = 0.0
    for s in shares[:-1]:
        acc += s
        targets.append(int(round(acc * len(text))))

    parts = []
    prev = 0
    for t in targets:
        # nearest break
        br = min(breaks, key=lambda b: abs(b - t))
        if br <= prev:
            br = next((b for b in breaks if b > prev), t)
        parts.append(text[prev:br].strip())
        prev = br
    parts.append(text[prev:].strip())
    while len(parts) < len(areas):
        parts.append("")
    return parts[: len(areas)]
