"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PromoPlan } from "@/domain/plan";
import type { Script } from "@/domain/script";
import type { Timeline } from "@/domain/timeline";
import type { QCReport } from "@/domain/qc";
import type { ReasonCode } from "@/domain/ledger";
import { DIALECT_NAMES, FORMAT_NAMES, type DialectCode, type FormatCode, type Ratio, type Verdict } from "@/domain/primitives";
import type { getJobView } from "@/services/pipeline/jobs";
import type { DeliveryView } from "./DeliveryPanel";
import { CostMeter } from "./CostMeter";
import { DeliveryPanel } from "./DeliveryPanel";
import { ErrorBox } from "./ErrorBox";
import { QCPanel, QCTable } from "./QCPanel";
import { StagePills } from "./StagePills";
import { TimelineInspector } from "./TimelineInspector";
import { TriRatioPlayer } from "./TriRatioPlayer";
import { VerdictBar } from "./VerdictBar";
import { api, ms, type ApiError } from "./lib/api";

export type JobView = Awaited<ReturnType<typeof getJobView>>;
type Tab = "stages" | "plan" | "timeline" | "preview" | "review";
type QueueItem = { promo_id: string; job_id: string };

const TERMINAL = new Set(["READY", "FAILED", "CANCELLED"]);
const RETRY_FROM = ["PLAN", "SCRIPT", "ASSEMBLE", "COMPOSE"] as const;
const RATIOS: Ratio[] = ["16:9", "9:16", "1:1"];

export function JobScreen({ initial, queue, delivery, initialTab }: { initial: JobView; queue: QueueItem[]; delivery: DeliveryView | null; initialTab: Tab }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [ratio, setRatio] = useState<Ratio>((initial.recipe?.ratios[0] as Ratio | undefined) ?? "9:16");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const live = !TERMINAL.has(job.stage);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(async () => {
      try {
        const next = await api<JobView>(`/api/v1/jobs/${job.id}`);
        setJob(next);
        if (TERMINAL.has(next.stage)) router.refresh();
      } catch {
        /* keep last known state; the next tick retries */
      }
    }, 2500);
    return () => clearInterval(id);
  }, [live, job.id, router]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  const elapsed = (job.finished_at ? new Date(job.finished_at).getTime() : now) - new Date(job.started_at ?? job.created_at).getTime();
  const plans = job.plans as Record<string, PromoPlan>;
  const timelines = job.timelines as Record<string, Timeline>;
  const qc = job.qc as Record<string, QCReport>;
  const script = job.script as Script | null;
  const renders = job.renders as Partial<Record<Ratio, string>>;
  const recipeRatios = (job.recipe?.ratios ?? RATIOS) as Ratio[];
  const queueIndex = useMemo(() => queue.findIndex((q) => q.promo_id === job.promo_id), [queue, job.promo_id]);

  const act = async (label: string, path: string, json?: unknown) => {
    setBusy(label);
    setError(null);
    try {
      const next = await api<JobView>(path, { method: "POST", json: json ?? {} });
      setJob(next);
      setTab("stages");
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const err = job.error as { code?: string; message?: string; recovery?: string; detail?: Record<string, unknown> } | null;
  const tabs: { key: Tab; label: string; enabled: boolean }[] = [
    { key: "stages", label: "Stages", enabled: true },
    { key: "plan", label: "Plan", enabled: Object.keys(plans).length > 0 },
    { key: "timeline", label: "Timeline", enabled: Object.keys(timelines).length > 0 },
    { key: "preview", label: "Preview", enabled: Object.keys(renders).length > 0 },
    { key: "review", label: "Review", enabled: !!job.promo },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-muted text-[12px] num">
            job {job.id}
            {job.promo_id ? ` · promo ${job.promo_id}` : ""}
            {job.title && (
              <>
                {" · "}
                <Link className="text-accent" href={`/t/${job.title.id}`}>
                  {job.title.name}
                </Link>
              </>
            )}
          </div>
          <h1 className="native-lg font-bold">{job.title?.name_native ?? job.title?.name ?? "Job"}</h1>
          <div className="text-muted">
            {job.recipe ? `${FORMAT_NAMES[job.recipe.format as FormatCode]} · ${DIALECT_NAMES[job.recipe.dialect as DialectCode]} · ${job.recipe.duration_s}s · ${job.recipe.ratios.join(" ")}` : ""}
            {job.angle ? <span className="text-ink"> · “{job.angle.claim}”</span> : ""}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-muted text-[12px]">elapsed</div>
            <div className="num text-ink">{ms(Math.max(0, elapsed))}</div>
          </div>
          <CostMeter spent={job.cost_spent_inr} envelope={job.cost_envelope_inr} breakdown={job.cost_breakdown as Record<string, number> | null} />
        </div>
      </header>

      <div className="flex items-center gap-4 flex-wrap">
        <StagePills stages={job.stages} onSelect={(s) => setTab(s === "PLAN" || s === "SCRIPT" ? "plan" : s === "COMPOSE" || s === "ASSEMBLE" ? "timeline" : "stages")} />
        <span className={`chip ${job.stage === "READY" ? "border-approved/60 text-approved" : job.stage === "FAILED" ? "border-rejected/60 text-rejected" : job.stage === "WAITING_PROVIDER" ? "border-amber text-amber" : ""}`}>{job.stage}</span>
        <div className="ml-auto flex items-center gap-1">
          {RETRY_FROM.map((s) => (
            <button key={s} className="btn btn-sm" disabled={busy !== null || live} onClick={() => act(`retry:${s}`, `/api/v1/jobs/${job.id}/retry`, { from_stage: s })} title={s === "COMPOSE" ? "No model is called: composition iteration is free" : `Reuses every artifact before ${s}`}>
              {busy === `retry:${s}` ? "…" : `Retry from ${s}`}
              {s === "COMPOSE" && <span className="text-approved num">₹0</span>}
            </button>
          ))}
          {live && (
            <button className="btn btn-sm text-rejected" disabled={busy !== null} onClick={() => act("cancel", `/api/v1/jobs/${job.id}/cancel`)}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {err && job.stage === "FAILED" && <ErrorBox error={{ code: err.code ?? "FAILED", message: err.message ?? "Job failed", recovery: err.recovery, detail: err.detail }} />}
      {job.stage === "WAITING_PROVIDER" && <div className="border border-amber/60 bg-amber/10 rounded-md p-3 text-[13px]">{err?.message ?? "Waiting for a provider."} Job holds at {job.resume_stage} and resumes automatically.</div>}
      <ErrorBox error={error} />

      <nav className="flex border-b border-hairline">
        {tabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? "tab-active" : ""} disabled:opacity-40`} disabled={!t.enabled} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
        {(tab === "timeline" || tab === "plan") && (
          <div className="ml-auto flex items-center gap-1 pb-1">
            {recipeRatios.map((r) => (
              <button key={r} className={`btn btn-sm num ${ratio === r ? "border-accent text-ink" : ""}`} onClick={() => setRatio(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
      </nav>

      {tab === "stages" && <StagesTab job={job} qc={qc} />}
      {tab === "plan" && <PlanTab plan={plans[ratio] ?? null} script={script} titleId={job.title?.id ?? null} ratio={ratio} />}
      {tab === "timeline" &&
        (timelines[ratio] ? (
          <TimelineInspector key={ratio} timeline={timelines[ratio]!} />
        ) : (
          <div className="text-faint">No timeline for {ratio} yet.</div>
        ))}
      {tab === "preview" && <TriRatioPlayer renders={renders} keyboard="full" height={460} />}
      {tab === "review" && job.promo && (
        <div className="space-y-4">
          <TriRatioPlayer renders={renders} keyboard="space" height={440} />
          <div className="panel p-3">
            <QCPanel qc={qc} compact />
          </div>
          <div className="panel p-3">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="font-medium">Verdict</h2>
              <span className="text-[12px] text-muted num">
                {queueIndex >= 0 ? `${queueIndex + 1} of ${queue.length} awaiting review · Enter records and advances` : `${queue.length} awaiting review`}
              </span>
            </div>
            <VerdictBar
              promoId={job.promo.id}
              existing={job.promo.verdict ? { verdict: job.promo.verdict as Verdict, reason_codes: (job.promo.reason_codes ?? []) as ReasonCode[], edit_minutes: job.promo.edit_minutes, note: job.promo.note } : null}
              onSubmitted={(r) => {
                if (r.next_job_id) router.push(`/j/${r.next_job_id}?tab=review`);
                else router.refresh();
              }}
            />
          </div>
          {delivery && (job.promo.status === "APPROVED" || job.promo.status === "SCHEDULED" || job.promo.status === "PUBLISHED" || job.promo.status === "MEASURED") && (
            <div className="panel p-3 space-y-2">
              <h2 className="font-medium">Delivery</h2>
              <DeliveryPanel promoId={job.promo.id} initial={delivery} defaultChannel={(job.recipe?.dialect as DialectCode) ?? "hry"} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StagesTab({ job, qc }: { job: JobView; qc: Record<string, QCReport> }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="panel p-3 space-y-2">
        <h2 className="font-medium">Stage timings</h2>
        <table className="w-full text-[12px]">
          <tbody>
            {job.stages.map((s) => (
              <tr key={s.stage} className="border-t border-hairline">
                <td className="py-1 text-ink">{s.stage}</td>
                <td className="py-1 text-muted">{s.state}</td>
                <td className="py-1 text-muted num text-right">{s.timing?.ms ? `${(s.timing.ms / 1000).toFixed(1)}s` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2 className="font-medium pt-2">Recipe</h2>
        {job.recipe && (
          <pre className="text-[11px] font-mono text-muted whitespace-pre-wrap break-all">{JSON.stringify({ id: job.recipe.id, seed: job.recipe.seed, dialect_pack_version: job.recipe.dialect_pack_version, prompt_versions: job.recipe.prompt_versions, cta_variant: job.recipe.cta_variant, music_brief: job.recipe.music_brief, cost_envelope_inr: job.recipe.cost_envelope_inr }, null, 2)}</pre>
        )}
        {job.raw_outputs.length > 0 && (
          <div className="text-[12px]">
            <div className="text-muted">Raw model outputs (contract failures)</div>
            {job.raw_outputs.map((k) => (
              <a key={k} className="text-accent block" href={`/media/${k}`} target="_blank" rel="noreferrer">
                {k}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="panel p-3 space-y-2">
        <h2 className="font-medium">QC · deterministic</h2>
        <QCTable qc={qc} />
        {Object.keys(qc).length === 0 && <div className="text-faint text-[12px]">QC has not run yet.</div>}
        <h2 className="font-medium pt-2">Assets · provenance</h2>
        <table className="w-full text-[12px]">
          <tbody>
            {job.assets.map((a) => {
              const p = a.provenance as { provider?: string; model?: string | null; prompt_version?: string | null } | null;
              return (
                <tr key={a.id} className="border-t border-hairline">
                  <td className="py-1 text-ink">{a.kind}</td>
                  <td className="py-1 text-muted num">{a.ratio ?? "–"}</td>
                  <td className="py-1 text-muted num">{a.duration_ms ? `${(a.duration_ms / 1000).toFixed(1)}s` : ""}</td>
                  <td className="py-1 text-muted">{p ? `${p.provider}${p.model ? ` · ${p.model}` : ""}${p.prompt_version ? ` · ${p.prompt_version}` : ""}` : <span className="text-rejected">no provenance</span>}</td>
                  <td className="py-1 text-amber text-right">{a.ai_generated ? "AI" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanTab({ plan, script, titleId, ratio }: { plan: PromoPlan | null; script: Script | null; titleId: string | null; ratio: Ratio }) {
  if (!plan) return <div className="text-faint">No plan for {ratio} yet.</div>;
  const fb = plan.frame_budget;
  const linesFor = (i: number) => script?.lines.filter((l) => l.beat_index === i) ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-[13px] flex-wrap">
        <span className="chip num">croppable {(fb.croppable_fraction * 100).toFixed(0)}%</span>
        <span className={`chip ${fb.composition_first ? "border-amber text-amber" : ""}`}>{fb.composition_first ? `composition-first: ${fb.chosen_composition}` : "crop permitted where the shot allows"}</span>
        <span className="chip num">{plan.total_duration_ms}ms</span>
        {script && (
          <span className={`chip num ${script.within_budget ? "" : "border-rejected text-rejected"}`}>
            words {script.total_words} / {script.budget_words}
          </span>
        )}
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="py-1 pr-3 font-normal">#</th>
            <th className="py-1 pr-3 font-normal">role</th>
            <th className="py-1 pr-3 font-normal">time</th>
            <th className="py-1 pr-3 font-normal">int.</th>
            <th className="py-1 pr-3 font-normal">treatment</th>
            <th className="py-1 pr-3 font-normal">evidence</th>
            <th className="py-1 pr-3 font-normal">script / caption</th>
          </tr>
        </thead>
        <tbody>
          {plan.beats.map((b) => (
            <tr key={b.index} className="border-t border-hairline align-top">
              <td className="py-2 pr-3 num text-muted">{b.index}</td>
              <td className="py-2 pr-3 font-medium">{b.role}</td>
              <td className="py-2 pr-3 num text-muted">
                {ms(b.start_ms)} +{(b.duration_ms / 1000).toFixed(1)}s
              </td>
              <td className="py-2 pr-3 num">
                <span className="text-accent">{"●".repeat(b.intensity)}</span>
                <span className="text-faint">{"○".repeat(10 - b.intensity)}</span> {b.intensity}
              </td>
              <td className="py-2 pr-3">
                <div className={b.treatment === "TRACKED_CROP" && ratio === "9:16" ? "text-amber" : "text-ink"}>{b.treatment}</div>
                <div className="text-[12px] text-muted">{b.treatment_reason}</div>
              </td>
              <td className="py-2 pr-3 text-[12px]">
                {b.evidence_ids.map((id) => (
                  <Link key={id} className="text-accent block num" href={titleId ? `/t/${titleId}?tab=evidence&unit=${id}` : "#"}>
                    {id}
                  </Link>
                ))}
              </td>
              <td className="py-2 pr-3">
                {linesFor(b.index).map((l) => (
                  <div key={l.id} className="native">
                    <span className="text-[11px] text-faint mr-2">{l.role}</span>
                    {l.text_native}
                    <span className="text-[11px] text-faint ml-2 num">{l.word_count}w</span>
                  </div>
                ))}
                {b.caption_text && !linesFor(b.index).some((l) => l.role === "caption") && <div className="native text-muted">{b.caption_text}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}