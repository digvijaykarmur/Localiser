"use client";

import { useEffect, useState } from "react";
import type { MetricsSummary } from "@/domain";

export default function MetricsPage() {
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/v1/metrics/summary")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setData(j);
      })
      .catch((e) => setErr(String(e.message)));
  }, []);
  return (
    <div className="grid" style={{ gap: 16 }}>
      <h1>Dashboard</h1>
      {err && <div className="muted">{err}</div>}
      <div className="row" style={{ flexWrap: "wrap" }}>
        {(data?.providers ?? []).map((p) => (
          <div key={p.provider} className="chip">
            {p.provider} · {p.last_error ?? "ok"}
          </div>
        ))}
      </div>
      {(data?.pairs ?? []).map((p) => (
        <div key={`${p.format}-${p.dialect}`} className="panel grid" style={{ gap: 8 }}>
          <h2>
            {p.format} · {p.dialect} · {p.ppp_tier}
          </h2>
          <div className="row tabular">
            <span>produced {p.produced}</span>
            <span>approval {p.approval_rate == null ? "—" : `${Math.round(p.approval_rate * 100)}%`}</span>
            <span>median edit {p.median_edit_minutes ?? "—"}m</span>
            <span>median ₹ {p.median_cost_approved_inr ?? "—"}</span>
            <span>ρ {p.judge_editor_spearman ?? "—"}</span>
          </div>
          <div className="row">
            {p.reason_histogram.map((h) => (
              <span key={h.code} className="chip">
                {h.code} {h.count}
              </span>
            ))}
          </div>
        </div>
      ))}
      {!data?.pairs.length && <div className="muted">No ledger rows yet.</div>}
    </div>
  );
}
