"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIALECT_NAMES, type DialectCode } from "@/domain/primitives";
import { api, inr, type ApiError } from "./lib/api";
import { ErrorBox } from "./ErrorBox";
import { TitleCard, type TitleListItem } from "./TitleCard";

type JobRow = { id: string; stage: string; promo_id: string | null; cost_spent_inr: number; created_at: string; format: string | null; dialect: string | null; duration_s: number | null; title: { id: string; name: string } | null };
type QueueRow = { promo_id: string; job_id: string; title: { id: string; name: string; name_native: string } | null; format: string | null; dialect: string | null; duration_s: number | null };
type DeliveryRow = { promo_id: string; job_id: string; status: string; scheduled_at: string | null; delivered_at: string | null; format: string | null; title: { id: string; name: string } | null };

export function Library({ titles, jobs, queue, delivery }: { titles: TitleListItem[]; jobs: JobRow[]; queue: QueueRow[]; delivery: DeliveryRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [dialect, setDialect] = useState<DialectCode | "">("");

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/titles", { method: "POST", json: dialect ? { dialect } : {} });
      router.refresh();
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const shown = titles.filter((t) => !dialect || t.dialect === dialect);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <select className="input" value={dialect} onChange={(e) => setDialect(e.target.value as DialectCode | "")}>
            <option value="">All dialects</option>
            {(Object.keys(DIALECT_NAMES) as DialectCode[]).map((d) => (
              <option key={d} value={d}>
                {DIALECT_NAMES[d]}
              </option>
            ))}
          </select>
          <button className="btn" onClick={sync} disabled={busy}>
            {busy ? "Syncing…" : "Sync titles"}
          </button>
          <span className="text-muted">
            {shown.length} title{shown.length === 1 ? "" : "s"}
          </span>
        </div>
        <ErrorBox error={error} />
        {shown.length === 0 ? (
          <div className="panel p-10 text-center space-y-3">
            <div className="text-ink">No titles yet.</div>
            <div className="text-muted">Connect a source or load a snapshot.</div>
            <div className="flex justify-center gap-2">
              <button className="btn btn-primary" onClick={sync} disabled={busy}>
                Sync from catalogue
              </button>
              <button className="btn" onClick={sync} disabled={busy} title="With SNAPSHOT_MODE=true or no credentials, sync reads src/data/snapshots">
                Load snapshot
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {shown.map((t) => (
              <TitleCard key={t.id} title={t} />
            ))}
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <div className="panel p-3">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-medium">Awaiting review</h2>
            <span className="text-muted num">{queue.length}</span>
          </div>
          {queue.length === 0 ? (
            <div className="text-muted text-[13px]">Nothing to review. Approved promos move to Campaigns.</div>
          ) : (
            <ul className="space-y-1">
              {queue.slice(0, 8).map((q) => (
                <li key={q.promo_id}>
                  <Link href={`/j/${q.job_id}?tab=review`} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-panel2">
                    <span className="truncate">{q.title?.name ?? q.promo_id}</span>
                    <span className="text-muted text-[12px] shrink-0">
                      {q.format} · {q.dialect} · {q.duration_s}s
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel p-3">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-medium">Delivery queue</h2>
            <span className="text-muted num">{delivery.length}</span>
          </div>
          {delivery.length === 0 ? (
            <div className="text-muted text-[13px]">Nothing approved and unpublished.</div>
          ) : (
            <ul className="space-y-1">
              {delivery.slice(0, 8).map((d) => (
                <li key={d.promo_id}>
                  <Link href={`/j/${d.job_id}?tab=review`} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-panel2">
                    <span className="truncate">{d.title?.name ?? d.promo_id}</span>
                    <span className={`text-[12px] shrink-0 ${d.status === "SCHEDULED" ? "text-approved" : "text-muted"}`}>
                      {d.format} · {d.status === "SCHEDULED" && d.scheduled_at ? new Date(d.scheduled_at).toLocaleDateString() : d.delivered_at ? "exported" : "approved"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel p-3">
          <h2 className="font-medium mb-2">Recent jobs</h2>
          {jobs.length === 0 ? (
            <div className="text-muted text-[13px]">No jobs yet. Open a title and compose a promo.</div>
          ) : (
            <ul className="space-y-1">
              {jobs.slice(0, 12).map((j) => (
                <li key={j.id}>
                  <Link href={`/j/${j.id}`} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-panel2">
                    <span className="truncate">
                      {j.title?.name ?? j.id} <span className="text-muted">· {j.format}</span>
                    </span>
                    <span className={`text-[12px] shrink-0 ${j.stage === "READY" ? "text-approved" : j.stage === "FAILED" ? "text-rejected" : "text-muted"}`}>
                      {j.stage} · {inr(j.cost_spent_inr)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
