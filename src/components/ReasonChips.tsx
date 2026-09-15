"use client";

import { REASON_LABELS, ReasonCode as ReasonCodeSchema, type ReasonCode } from "@/domain/ledger";

export const REASON_CODES = ReasonCodeSchema.options;

/** Fourteen fixed reason codes (§3.8). Required for verdicts 3–4, optional for 2, hidden for 1. */
export function ReasonChips({ value, onChange, required, disabled }: { value: ReasonCode[]; onChange: (v: ReasonCode[]) => void; required: boolean; disabled?: boolean }) {
  const toggle = (c: ReasonCode) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {REASON_CODES.map((c, i) => {
          const on = value.includes(c);
          return (
            <button key={c} type="button" disabled={disabled} onClick={() => toggle(c)} className={`chip h-7 ${on ? "border-accent text-ink bg-accent/15" : "hover:border-muted"}`} title={`R + ${i + 1}`}>
              <span className="num text-[11px] opacity-70">{c.slice(0, 3)}</span>
              {REASON_LABELS[c]}
            </button>
          );
        })}
      </div>
      {required && value.length === 0 && <div className="text-[12px] text-major mt-1">At least one reason code is required for this verdict.</div>}
    </div>
  );
}
