"use client";

import { D_CHECK_LABELS, type QCReport } from "@/domain/qc";
import type { Ratio } from "@/domain/primitives";

const GATES = ["A1_subject_integrity", "A2_claim_truth", "A3_spoiler", "A4_text_legibility"] as const;
const SCORES = ["A6_hook_strength", "A7_pacing", "A8_overall_craft"] as const;

/** One QC line per ratio: D1–D17 ✓ collapsed when all pass, failures spelled out; A1–A8 beside (§8). */
export function QCPanel({ qc, compact = false }: { qc: Record<string, QCReport>; compact?: boolean }) {
  const ratios = Object.keys(qc) as Ratio[];
  if (ratios.length === 0) return <div className="text-faint text-[12px]">QC has not run yet.</div>;
  return (
    <div className="space-y-2">
      {ratios.map((r) => {
        const rep = qc[r]!;
        const failed = rep.deterministic.checks.filter((c) => !c.pass);
        return (
          <div key={r} className="text-[13px]">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="num text-muted w-10">{r}</span>
              <span className={rep.deterministic.all_pass ? "text-approved" : "text-rejected"}>
                {rep.deterministic.all_pass ? "D1–D17 ✓" : `${failed.map((f) => f.id).join(" ")} ✕`}
              </span>
              {rep.ai ? (
                <>
                  {GATES.map((g) => {
                    const v = rep.ai!.judge[g];
                    return (
                      <span key={g} className={v.pass ? "text-approved" : "text-rejected"} title={v.evidence}>
                        {g.slice(0, 2)} {v.pass ? "✓" : "✕"}
                      </span>
                    );
                  })}
                  {SCORES.map((s) => (
                    <span key={s} className="text-muted num" title={rep.ai!.judge[s].reasoning}>
                      {s.slice(0, 2)} {rep.ai!.judge[s].score}
                    </span>
                  ))}
                  {rep.ai.A5_dialect_similarity !== null && (
                    <span className={rep.ai.A5_dialect_similarity >= 0.85 ? "text-muted num" : "text-amber num"} title="ASR vs intended script">
                      A5 {rep.ai.A5_dialect_similarity.toFixed(2)}
                    </span>
                  )}
                  {rep.ai.warnings.map((w, i) => (
                    <span key={i} className="text-amber">
                      ⚠ {w}
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-faint">judge not run</span>
              )}
              <span className={`ml-auto chip ${rep.gate_pass ? "border-approved/60 text-approved" : "border-rejected/60 text-rejected"}`}>{rep.gate_pass ? "gate pass" : "gate fail"}</span>
            </div>
            {!compact && failed.length > 0 && (
              <ul className="mt-1 ml-12 space-y-0.5 text-muted">
                {failed.map((f) => (
                  <li key={f.id}>
                    <span className="text-rejected">{f.id}</span> {D_CHECK_LABELS[f.id as keyof typeof D_CHECK_LABELS] ?? ""} — {f.detail}
                  </li>
                ))}
              </ul>
            )}
            {!compact && rep.ai && (
              <div className="mt-1 ml-12 space-y-0.5 text-muted">
                {GATES.filter((g) => !rep.ai!.judge[g].pass).map((g) => (
                  <div key={g}>
                    <span className="text-rejected">{g}</span> — {rep.ai!.judge[g].evidence}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Full D1–D17 table for the Stages tab. */
export function QCTable({ qc }: { qc: Record<string, QCReport> }) {
  const ratios = Object.keys(qc) as Ratio[];
  if (ratios.length === 0) return null;
  const ids = qc[ratios[0]!]!.deterministic.checks.map((c) => c.id);
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-muted text-left">
          <th className="py-1 pr-2 font-normal">check</th>
          {ratios.map((r) => (
            <th key={r} className="py-1 pr-2 font-normal num">
              {r}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => (
          <tr key={id} className="border-t border-hairline">
            <td className="py-1 pr-2 text-muted">
              <span className="text-ink num mr-2">{id}</span>
              {D_CHECK_LABELS[id as keyof typeof D_CHECK_LABELS] ?? ""}
            </td>
            {ratios.map((r) => {
              const c = qc[r]!.deterministic.checks.find((x) => x.id === id);
              return (
                <td key={r} className={`py-1 pr-2 ${c?.pass ? "text-approved" : "text-rejected"}`} title={c?.detail}>
                  {c ? (c.pass ? "✓" : "✕") : "–"} <span className="text-faint">{c?.measured !== undefined && c?.measured !== null ? String(c.measured) : ""}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
