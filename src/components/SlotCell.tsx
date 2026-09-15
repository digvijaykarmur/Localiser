"use client";

import Link from "next/link";
import type { SlotStatus } from "@/domain/campaign";
import type { FormatCode } from "@/domain/primitives";
import { inr } from "./lib/api";

export interface SlotView {
  id: string;
  date: string;
  intended_format: FormatCode;
  title_id: string | null;
  recipe_id: string | null;
  promo_id: string | null;
  job_id: string | null;
  status: SlotStatus;
  title: { id: string; name: string; name_native: string } | null;
  job_stage: string | null;
  cost_inr: number;
}

const STATUS: Record<SlotStatus, { glyph: string; label: string; cls: string }> = {
  EMPTY: { glyph: "○", label: "slot", cls: "text-faint" },
  PLANNED: { glyph: "◐", label: "planned", cls: "text-muted" },
  GENERATING: { glyph: "⚙", label: "generating", cls: "text-accent" },
  AWAITING_REVIEW: { glyph: "⏳", label: "review", cls: "text-minor" },
  APPROVED: { glyph: "✓", label: "approved", cls: "text-approved" },
  SCHEDULED: { glyph: "◷", label: "scheduled", cls: "text-approved" },
  PUBLISHED: { glyph: "●", label: "published", cls: "text-ink" },
  MEASURED: { glyph: "◆", label: "measured", cls: "text-ink" },
};

/** One calendar cell. An empty slot is a visible gap — that is the point (§10, §29). */
export function SlotCell({ slot, selected, selectable, onToggle }: { slot: SlotView; selected: boolean; selectable: boolean; onToggle: (id: string) => void }) {
  const s = STATUS[slot.status];
  const href = slot.job_id ? `/j/${slot.job_id}${slot.status === "AWAITING_REVIEW" ? "?tab=review" : ""}` : null;
  return (
    <div className={`panel p-2 min-h-[84px] text-[12px] flex flex-col gap-1 ${selected ? "border-accent" : ""} ${selectable ? "cursor-pointer hover:border-muted" : ""}`} onClick={() => selectable && onToggle(slot.id)} role={selectable ? "checkbox" : undefined} aria-checked={selectable ? selected : undefined}>
      <div className="flex items-center justify-between">
        <span className={`${s.cls}`}>
          {s.glyph} {slot.status === "EMPTY" ? "slot" : slot.intended_format}
        </span>
        {selectable && <input type="checkbox" readOnly checked={selected} className="accent-[#3D7EFF]" onClick={(e) => e.stopPropagation()} onChange={() => onToggle(slot.id)} />}
      </div>
      {slot.title ? (
        <div className="native leading-tight text-ink truncate" title={slot.title.name}>
          {slot.title.name_native}
        </div>
      ) : (
        <div className="text-faint">{slot.intended_format} · empty</div>
      )}
      <div className={`mt-auto flex items-center justify-between ${s.cls}`}>
        <span>
          {s.label}
          {slot.status === "GENERATING" && slot.job_stage ? ` · ${slot.job_stage}` : ""}
        </span>
        {slot.cost_inr > 0 && <span className="num text-muted">{inr(slot.cost_inr)}</span>}
      </div>
      {href && (
        <Link className="text-accent" href={href} onClick={(e) => e.stopPropagation()}>
          open →
        </Link>
      )}
    </div>
  );
}
