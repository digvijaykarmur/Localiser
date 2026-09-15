"use client";

import { useState } from "react";
import type { DeliveryManifest } from "@/domain/campaign";
import { DIALECT_NAMES, type DialectCode } from "@/domain/primitives";
import { ErrorBox } from "./ErrorBox";
import { api, inr, type ApiError } from "./lib/api";

export interface DeliveryView {
  promo_id: string;
  status: string;
  verdict: string | null;
  channel: DialectCode | null;
  scheduled_at: string | null;
  delivered_at: string | null;
  published_at: string | null;
  ratios: string[];
  gate: { ok: boolean; problems: string[] };
  ai_generated: boolean;
  ai_generated_by_asset_class: Record<string, boolean>;
  exports: Record<string, string>;
  manifest: DeliveryManifest | null;
}

/** J7 (§12, §30): gate → schedule → export bundle → mark published. AI-disclosure badge when any asset class is generated. */
export function DeliveryPanel({ promoId, initial, defaultChannel }: { promoId: string; initial: DeliveryView; defaultChannel: DialectCode }) {
  const [view, setView] = useState(initial);
  const [channel, setChannel] = useState<DialectCode>(initial.channel ?? defaultChannel);
  const [when, setWhen] = useState(initial.scheduled_at ? initial.scheduled_at.slice(0, 16) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const run = async (label: string, fn: () => Promise<DeliveryView>) => {
    setBusy(label);
    setError(null);
    try {
      setView(await fn());
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const schedule = () => run("schedule", () => api(`/api/v1/promos/${promoId}/schedule`, { method: "POST", json: { channel, scheduled_at: new Date(when).toISOString() } }));
  const deliver = () => run("deliver", () => api(`/api/v1/promos/${promoId}/deliver`, { method: "POST", json: {} }));
  const publish = () => run("publish", () => api(`/api/v1/promos/${promoId}/deliver`, { method: "POST", json: { published: true } }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="chip">{view.status}</span>
        <span className={`chip ${view.gate.ok ? "border-approved/60 text-approved" : "border-rejected/60 text-rejected"}`}>{view.gate.ok ? "delivery gate open" : "delivery gate closed"}</span>
        {view.ai_generated && (
          <span className="chip border-amber text-amber" title={Object.entries(view.ai_generated_by_asset_class).filter(([, v]) => v).map(([k]) => k).join(", ")}>
            AI-generated content — apply the platform label
          </span>
        )}
      </div>
      {!view.gate.ok && (
        <ul className="text-[13px] text-muted list-disc pl-5 space-y-0.5">
          {view.gate.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="panel p-3 space-y-2">
          <div className="text-muted text-[12px]">1 · Schedule</div>
          <select className="input w-full" value={channel} onChange={(e) => setChannel(e.target.value as DialectCode)} disabled={!!view.published_at}>
            {(Object.keys(DIALECT_NAMES) as DialectCode[]).map((d) => (
              <option key={d} value={d}>
                {DIALECT_NAMES[d]}
              </option>
            ))}
          </select>
          <input type="datetime-local" className="input w-full num" value={when} onChange={(e) => setWhen(e.target.value)} disabled={!!view.published_at} />
          <button className="btn w-full" disabled={!view.gate.ok || !when || busy !== null || !!view.published_at} onClick={schedule}>
            {busy === "schedule" ? "Scheduling…" : view.scheduled_at ? "Reschedule" : "Schedule"}
          </button>
          {view.scheduled_at && <div className="text-[12px] text-muted num">for {new Date(view.scheduled_at).toLocaleString()}</div>}
        </div>

        <div className="panel p-3 space-y-2">
          <div className="text-muted text-[12px]">2 · Export bundle</div>
          <div className="text-[12px] text-muted">
            {view.ratios.map((r) => `${promoId}_${r.replace(":", "x")}.mp4`).join(" · ")} · manifest.json
            <br />
            promo_id is written into each filename and the mp4 <code>comment</code> tag (§30.2).
          </div>
          <button className="btn w-full" disabled={!view.gate.ok || busy !== null} onClick={deliver}>
            {busy === "deliver" ? "Exporting…" : view.delivered_at ? "Re-export" : "Export"}
          </button>
          {Object.keys(view.exports).length > 0 && (
            <div className="flex flex-wrap gap-2 text-[12px]">
              {Object.entries(view.exports).map(([k, u]) => (
                <a key={k} className="text-accent" href={u} target="_blank" rel="noreferrer">
                  {k}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="panel p-3 space-y-2">
          <div className="text-muted text-[12px]">3 · Publish (manual in v1)</div>
          <div className="text-[12px] text-muted">Upload the bundle to the channel, then record it here so the daily outcome sync can join on promo_id.</div>
          <button className="btn btn-primary w-full" disabled={!view.delivered_at || busy !== null || !!view.published_at} onClick={publish}>
            {busy === "publish" ? "Recording…" : view.published_at ? `Published ${new Date(view.published_at).toLocaleDateString()}` : "Mark published"}
          </button>
        </div>
      </div>

      <ErrorBox error={error} />

      {view.manifest && (
        <details className="panel p-3">
          <summary className="cursor-pointer text-muted text-[13px]">
            manifest.json · {view.manifest.dialect_pack_version} · {inr(view.manifest.cost_inr)} · {view.manifest.evidence_ids.length} evidence ids
          </summary>
          <pre className="mt-2 text-[11px] font-mono text-muted whitespace-pre-wrap break-all">{JSON.stringify(view.manifest, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
