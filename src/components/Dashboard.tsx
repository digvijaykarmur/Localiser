"use client";

import { useState } from "react";
import { REASON_LABELS } from "@/domain/ledger";
import { DIALECT_NAMES, FORMAT_NAMES } from "@/domain/primitives";
import type { MetricsSummary } from "@/services/metrics/summary";
import { MetricTile } from "./MetricTile";
import { ErrorBox } from "./ErrorBox";
import { api, inr, pct, type ApiError } from "./lib/api";

const TIER_CLS = { PROVE: "border-hairline text-muted", PILOT: "border-minor text-minor", PRODUCTION: "border-approved text-approved" } as const;

/** J6 — five numbers per (format, dialect), nothing else (§11, §32.3). The reason-code histogram is the roadmap. */
export function Dashboard({ summary }: { summary: MetricsSummary }) {
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const rho = summary.judge_editor_correlation;
  const target = summary.baseline_edit_minutes !== null ? summary.baseline_edit_minutes / 3 : null;
  const allMedians = summary.pairs.map((p) => p.median_edit_minutes).filter((x): x is number => x !== null);
  const overallHist = new Map<string, number>();
  for (const p of summary.pairs) for (const r of p.reason_codes) overallHist.set(r.code, (overallHist.get(r.code) ?? 0) + r.count);
  const top = [...overallHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCount = top[0]?.[1] ?? 1;

  const syncOutcomes = async () => {
    setSyncing(true);
    setError(null);
    try {
      const r = await api<{ received: number; matched: number; unmatched: string[] }>("/api/v1/outcomes", { method: "POST", json: {} });
      setSynced(`${r.matched} of ${r.received} rows joined on promo_id${r.unmatched.length ? ` · ${r.unmatched.length} unmatched` : ""}`);
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-medium">Weekly learning</h1>
          <div className="text-muted text-[13px]">Computed {new Date(summary.computed_at).toLocaleString()} from the ledger. Reviewed every Monday.</div>
        </div>
        <div className="flex items-center gap-2">
          {synced && <span className="text-[12px] text-muted">{synced}</span>}
          <button className="btn" disabled={syncing} onClick={syncOutcomes} title="Pull analytics.promo_performance and join on promo_id">
            {syncing ? "Syncing…" : "Sync outcomes"}
          </button>
        </div>
      </header>
      <ErrorBox error={error} />

      <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricTile label="Promos produced" value={String(summary.totals.promos)} sub={`${summary.totals.reviewed} reviewed`} />
        <MetricTile label="Approval rate" value={summary.totals.reviewed ? pct(summary.totals.approved / summary.totals.reviewed) : "—"} sub={`${summary.totals.approved} approved`} />
        <MetricTile
          label="Median edit-minutes"
          value={allMedians.length ? `${medianOf(allMedians)} min` : "—"}
          sub={summary.baseline_edit_minutes !== null ? `baseline ${summary.baseline_edit_minutes} · target < ${target!.toFixed(1)}` : "no baseline in docs/BASELINE.md"}
          tone={allMedians.length && target !== null ? (medianOf(allMedians) < target ? "approved" : "amber") : "ink"}
        />
        <MetricTile label="Total spend" value={inr(summary.totals.spend_inr)} />
        <MetricTile
          label="Judge ↔ editor (Spearman)"
          value={rho.spearman === null ? "—" : rho.spearman.toFixed(2)}
          sub={rho.n < 50 ? `${rho.n} of 50 reviewed promos needed` : rho.calibrated ? "calibrated — judge may become a gate" : "below 0.5 — judge stays decoration"}
          tone={rho.spearman === null ? "muted" : rho.calibrated ? "approved" : rho.n >= 50 ? "rejected" : "amber"}
        />
        <div className="panel p-3">
          <div className="text-[12px] text-muted">Reason codes · top 5 (the roadmap)</div>
          {top.length === 0 ? (
            <div className="text-faint text-[12px] mt-2">No rejections recorded yet.</div>
          ) : (
            <div className="mt-2 space-y-1">
              {top.map(([code, n]) => (
                <div key={code} className="flex items-center gap-2 text-[12px]">
                  <span className="w-[92px] truncate text-muted" title={code}>
                    {code.slice(0, 3)} {REASON_LABELS[code as keyof typeof REASON_LABELS]}
                  </span>
                  <div className="flex-1 h-2 bg-hairline rounded overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${(n / maxCount) * 100}%` }} />
                  </div>
                  <span className="num w-5 text-right">{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="p-3 font-normal">format · dialect</th>
              <th className="p-3 font-normal num text-right">1 · produced</th>
              <th className="p-3 font-normal num text-right">2 · approval</th>
              <th className="p-3 font-normal num text-right">3 · median edit-min</th>
              <th className="p-3 font-normal num text-right">4 · median ₹ / approved</th>
              <th className="p-3 font-normal">5 · reason codes</th>
              <th className="p-3 font-normal">PPP tier</th>
            </tr>
          </thead>
          <tbody>
            {summary.pairs.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-faint">
                  No ledger rows yet. The first promo through QC writes row #1.
                </td>
              </tr>
            )}
            {summary.pairs.map((p) => (
              <tr key={`${p.format}${p.dialect}`} className="border-t border-hairline">
                <td className="p-3">
                  <div className="text-ink">{FORMAT_NAMES[p.format]}</div>
                  <div className="text-muted text-[12px]">{DIALECT_NAMES[p.dialect]}</div>
                </td>
                <td className="p-3 num text-right">
                  {p.promos} <span className="text-faint">/ {p.reviewed} rev.</span>
                </td>
                <td className="p-3 num text-right">{p.reviewed ? pct(p.approval_rate) : "—"}</td>
                <td className={`p-3 num text-right ${p.median_edit_minutes !== null && target !== null ? (p.median_edit_minutes < target ? "text-approved" : "text-amber") : ""}`}>{p.median_edit_minutes === null ? "—" : `${p.median_edit_minutes}`}</td>
                <td className="p-3 num text-right">{inr(p.median_cost_approved_inr)}</td>
                <td className="p-3">
                  <div className="flex gap-1 flex-wrap">
                    {p.reason_codes.length === 0 && <span className="text-faint">—</span>}
                    {p.reason_codes.map((r) => (
                      <span key={r.code} className="chip" title={r.code}>
                        {r.code.slice(0, 3)} {REASON_LABELS[r.code]} <span className="num text-ink">{r.count}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-3">
                  <span className={`chip ${TIER_CLS[p.tier]}`}>{p.tier}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-[12px] text-faint max-w-3xl">
        PROVE &lt; 20 promos · PILOT ≥ 20, approval ≥ 60%, median edit ≤ 10 min · PRODUCTION ≥ 50, approval ≥ 80%, median edit ≤ 4 min, zero R01/R02 in the last 30. Tiers are recomputed nightly from the ledger and never hand-set.
      </p>
    </div>
  );
}

function medianOf(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round(((s[m - 1]! + s[m]!) / 2) * 10) / 10;
}
