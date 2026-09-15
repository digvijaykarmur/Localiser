"use client";

import { useEffect, useRef, useState } from "react";
import type { ReasonCode } from "@/domain/ledger";
import type { Verdict } from "@/domain/primitives";
import { ReasonChips, REASON_CODES } from "./ReasonChips";
import { REPLAY_EVENT } from "./TriRatioPlayer";
import { ErrorBox } from "./ErrorBox";
import { api, type ApiError } from "./lib/api";

const VERDICTS: { key: Verdict; n: number; label: string; cls: string }[] = [
  { key: "approved", n: 1, label: "Approve", cls: "border-approved text-approved data-[on=true]:bg-approved data-[on=true]:text-white" },
  { key: "minor_edit", n: 2, label: "Minor edit", cls: "border-minor text-minor data-[on=true]:bg-minor data-[on=true]:text-black" },
  { key: "major_edit", n: 3, label: "Major edit", cls: "border-major text-major data-[on=true]:bg-major data-[on=true]:text-white" },
  { key: "rejected", n: 4, label: "Reject", cls: "border-rejected text-rejected data-[on=true]:bg-rejected data-[on=true]:text-white" },
];

export interface ReviewResult {
  promo_id: string;
  status: string;
  verdict: Verdict;
  next_promo_id: string | null;
  next_job_id: string | null;
}

/**
 * Keyboard-driven verdict capture (§8). 1–4 verdict · R+number toggles a reason code · Enter submits.
 * No modal, no confirmation. `edit_minutes` is the product's definition of done — required for 2 and 3.
 */
export function VerdictBar({ promoId, existing, onSubmitted }: { promoId: string; existing: { verdict: Verdict | null; reason_codes: ReasonCode[]; edit_minutes: number | null; note: string | null } | null; onSubmitted: (r: ReviewResult) => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(existing?.verdict ?? null);
  const [codes, setCodes] = useState<ReasonCode[]>(existing?.reason_codes ?? []);
  const [minutes, setMinutes] = useState<string>(existing?.edit_minutes !== null && existing?.edit_minutes !== undefined ? String(existing.edit_minutes) : "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const rBuffer = useRef<{ digits: string; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const minutesRef = useRef<HTMLInputElement>(null);

  const needsCodes = verdict === "major_edit" || verdict === "rejected";
  const needsMinutes = verdict === "minor_edit" || verdict === "major_edit";
  const showCodes = verdict !== null && verdict !== "approved";
  const minutesNum = minutes.trim() === "" ? null : Number(minutes);
  const valid = verdict !== null && (!needsCodes || codes.length > 0) && (!needsMinutes || (minutesNum !== null && Number.isFinite(minutesNum) && minutesNum >= 0));

  const submit = async () => {
    if (!valid || busy || !verdict) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<ReviewResult>(`/api/v1/promos/${promoId}/review`, {
        method: "POST",
        json: { verdict, reason_codes: verdict === "approved" ? [] : codes, edit_minutes: needsMinutes || verdict === "rejected" ? minutesNum : null, note: note.trim() || null },
      });
      onSubmitted(r);
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const commitR = () => {
    const b = rBuffer.current;
    rBuffer.current = null;
    if (!b) return;
    if (b.digits === "") {
      window.dispatchEvent(new Event(REPLAY_EVENT));
      return;
    }
    const n = Number(b.digits);
    const code = REASON_CODES[n - 1];
    if (code && showCodes) setCodes((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Enter" && !e.shiftKey && (!inField || tag === "INPUT")) {
        e.preventDefault();
        void submit();
        return;
      }
      if (inField) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const buf = rBuffer.current;
      if (buf) {
        if (/^\d$/.test(e.key)) {
          e.preventDefault();
          buf.digits += e.key;
          if (buf.timer) clearTimeout(buf.timer);
          if (buf.digits.length >= 2) commitR();
          else buf.timer = setTimeout(commitR, 650);
          return;
        }
        if (buf.timer) clearTimeout(buf.timer);
        commitR();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        rBuffer.current = { digits: "", timer: setTimeout(commitR, 650) };
        return;
      }
      if (/^[1-4]$/.test(e.key)) {
        e.preventDefault();
        const v = VERDICTS[Number(e.key) - 1]!.key;
        setVerdict(v);
        if (v === "minor_edit" || v === "major_edit") setTimeout(() => minutesRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, busy, verdict, codes, minutes, note, showCodes]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {VERDICTS.map((v) => (
          <button key={v.key} type="button" data-on={verdict === v.key} onClick={() => setVerdict(v.key)} className={`btn h-9 px-4 bg-transparent font-medium ${v.cls}`}>
            <span className="kbd">{v.n}</span> {v.label}
          </button>
        ))}
      </div>

      {showCodes && <ReasonChips value={codes} onChange={setCodes} required={needsCodes} />}

      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-muted">
          Edit minutes
          <input ref={minutesRef} className="input w-20 num" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d.]/g, ""))} placeholder={needsMinutes ? "required" : "—"} />
        </label>
        <label className="flex items-center gap-2 text-muted flex-1 min-w-[200px]">
          Note
          <input className="input flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" maxLength={500} />
        </label>
        <button className="btn btn-primary h-9" disabled={!valid || busy} onClick={submit}>
          {busy ? "Recording…" : "Record verdict"} <span className="kbd bg-white/20 text-white border-white/30">↵</span>
        </button>
      </div>
      {needsMinutes && minutesNum === null && <div className="text-[12px] text-major">Edit minutes are required for this verdict — this number is the product&apos;s definition of done.</div>}
      <ErrorBox error={error} />
      {existing?.verdict && (
        <div className="text-[12px] text-muted">
          Recorded: <span className="text-ink">{existing.verdict}</span>
          {existing.reason_codes.length ? ` · ${existing.reason_codes.join(", ")}` : ""}
          {existing.edit_minutes !== null ? ` · ${existing.edit_minutes} min` : ""}. Recording again overwrites it.
        </div>
      )}
    </div>
  );
}
