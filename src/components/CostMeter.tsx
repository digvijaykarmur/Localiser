"use client";

import { inr } from "./lib/api";

/** Spent vs envelope, in rupees. under · near (>80%) · exceeded (§28.4). */
export function CostMeter({ spent, envelope, breakdown }: { spent: number; envelope: number | null; breakdown?: Record<string, number> | null }) {
  const frac = envelope ? Math.min(1, spent / envelope) : 0;
  const state = envelope && spent > envelope ? "exceeded" : frac > 0.8 ? "near" : "under";
  const colour = state === "exceeded" ? "bg-rejected" : state === "near" ? "bg-amber" : "bg-accent";
  const entries = Object.entries(breakdown ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="min-w-[200px]" title={entries.map(([k, v]) => `${k}: ${inr(v)}`).join("\n")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`num font-medium ${state === "exceeded" ? "text-rejected" : "text-ink"}`}>{inr(spent)}</span>
        <span className="num text-muted text-[12px]">{envelope ? `of ${inr(envelope)} envelope` : "no envelope"}</span>
      </div>
      <div className="h-1.5 mt-1 rounded bg-hairline overflow-hidden">
        <div className={`h-full ${colour} transition-[width]`} style={{ width: `${frac * 100}%` }} />
      </div>
      {entries.length > 0 && (
        <div className="mt-1 flex gap-2 flex-wrap text-[11px] text-faint num">
          {entries.slice(0, 4).map(([k, v]) => (
            <span key={k}>
              {k} {inr(v)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
