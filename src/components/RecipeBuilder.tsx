"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Angle, FormatPolicy, Preset, Title } from "@/domain";
import { DIALECT_NAMES, DURATIONS, FORMAT_NAMES, type DialectCode, type Duration, type FormatCode, type PPPTier, type Ratio } from "@/domain/primitives";
import { ErrorBox } from "./ErrorBox";
import { FrameBudgetBar, type FrameBudgetView } from "./FrameBudgetBar";
import { api, inr, type ApiError } from "./lib/api";

interface Preview {
  frame_budget: FrameBudgetView;
  estimate: { total: number; breakdown: Record<string, number> };
  eligible_evidence: number;
  min_evidence: number;
  envelope_inr: number;
  ok: boolean;
  problems: string[];
}

const TIER_COLOUR: Record<PPPTier, string> = { PROVE: "text-muted", PILOT: "text-amber", PRODUCTION: "text-approved" };

/** One screen, no wizard (§7.1 ③). Cost is always shown before it is spent. */
export function RecipeBuilder(props: { title: Title; angles: Angle[]; angleId: string | null; onAngle: (id: string) => void; presets: Preset[]; tiers: Record<FormatCode, PPPTier>; formats: FormatPolicy[]; ctaVariants: string[] }) {
  const router = useRouter();
  const [format, setFormat] = useState<FormatCode>("SC");
  const [dialect, setDialect] = useState<DialectCode>(props.title.dialect);
  const [duration, setDuration] = useState<Duration>(20);
  const [ratios, setRatios] = useState<Ratio[]>(["16:9", "9:16", "1:1"]);
  const [cta, setCta] = useState(props.ctaVariants[0] ?? "default");
  const [music, setMusic] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [presetName, setPresetName] = useState("");
  const policy = props.formats.find((f) => f.code === format)!;

  const request = useMemo(
    () => ({ title_id: props.title.id, angle_id: props.angleId, format, dialect, duration_s: duration, ratios, cta_variant: cta, music_brief: policy.has_music && music.trim() ? music.trim() : null, persona_id: policy.has_presenter ? "persona_default" : null, source_window: null }),
    [props.title.id, props.angleId, format, dialect, duration, ratios, cta, music, policy.has_music, policy.has_presenter],
  );

  useEffect(() => {
    if (!props.angleId || ratios.length === 0) return;
    let live = true;
    api<Preview>("/api/v1/recipes?preview=1", { method: "POST", json: request })
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) }));
    return () => {
      live = false;
    };
  }, [request, props.angleId, ratios.length]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ recipe: { id: string } }>("/api/v1/recipes", { method: "POST", json: request });
      const j = await api<{ job_id: string }>("/api/v1/jobs", { method: "POST", json: { recipe_id: r.recipe.id } });
      router.push(`/j/${j.job_id}`);
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
      setBusy(false);
    }
  };

  const applyPreset = (p: Preset) => {
    setFormat(p.format);
    setDialect(p.dialect);
    setDuration(p.duration_s);
    setRatios(p.ratios);
    setCta(p.cta_variant);
    setMusic(p.music_brief ?? "");
  };

  const savePreset = async () => {
    if (!presetName.trim()) return;
    try {
      await api("/api/v1/presets", { method: "POST", json: { name: presetName.trim(), format, dialect, duration_s: duration, ratios, cta_variant: cta, music_brief: policy.has_music && music.trim() ? music.trim() : null } });
      setPresetName("");
      router.refresh();
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    }
  };

  const toggleRatio = (r: Ratio) => setRatios((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
  const canGenerate = !!props.angleId && ratios.length > 0 && preview?.ok && !busy;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
      <div className="space-y-4">
        <Row label="Format">
          <div className="flex gap-2 flex-wrap">
            {props.formats.map((f) => (
              <button key={f.code} className={`btn ${format === f.code ? "btn-primary" : ""}`} onClick={() => setFormat(f.code)} title={f.description}>
                {FORMAT_NAMES[f.code]}
                <span className={`text-[11px] ${format === f.code ? "text-white/80" : TIER_COLOUR[props.tiers[f.code]]}`}>{props.tiers[f.code]}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Angle">
          <select className="input w-full" value={props.angleId ?? ""} onChange={(e) => props.onAngle(e.target.value)}>
            {props.angles.length === 0 && <option value="">No angles — build intelligence first</option>}
            {props.angles.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.spoiler_safe}>
                {a.kind} · {a.claim}
                {a.vertical_feasible ? "" : " (vertical hard)"}
              </option>
            ))}
          </select>
        </Row>
        <div className="grid grid-cols-2 gap-4">
          <Row label="Dialect">
            <select className="input w-full" value={dialect} onChange={(e) => setDialect(e.target.value as DialectCode)}>
              {(Object.keys(DIALECT_NAMES) as DialectCode[]).map((d) => (
                <option key={d} value={d}>
                  {DIALECT_NAMES[d]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Duration">
            <div className="flex gap-1">
              {DURATIONS.map((d) => (
                <button key={d} className={`btn ${duration === d ? "btn-primary" : ""}`} onClick={() => setDuration(d)}>
                  {d}
                </button>
              ))}
            </div>
          </Row>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Row label="Ratios">
            <div className="flex gap-1">
              {(["16:9", "9:16", "1:1"] as Ratio[]).map((r) => (
                <button key={r} className={`btn ${ratios.includes(r) ? "btn-primary" : ""}`} onClick={() => toggleRatio(r)}>
                  {ratios.includes(r) ? "✓ " : ""}
                  {r}
                </button>
              ))}
            </div>
          </Row>
          <Row label="CTA">
            <select className="input w-full" value={cta} onChange={(e) => setCta(e.target.value)}>
              {props.ctaVariants.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Row>
        </div>
        {policy.has_music && (
          <Row label="Music brief">
            <input className="input w-full" maxLength={120} placeholder="optional, e.g. restrained tabla and strings, rising tension" value={music} onChange={(e) => setMusic(e.target.value)} />
          </Row>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-muted uppercase tracking-wide w-24">Presets</span>
          {props.presets.map((p) => (
            <button key={p.id} className="chip hover:border-muted" onClick={() => applyPreset(p)} title={`${FORMAT_NAMES[p.format]} · ${DIALECT_NAMES[p.dialect]} · ${p.duration_s}s · ${p.ratios.join(" ")}`}>
              {p.name}
            </button>
          ))}
          <input className="input btn-sm w-40" placeholder="preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
          <button className="btn btn-sm" onClick={savePreset} disabled={!presetName.trim()}>
            Save as preset
          </button>
        </div>
        <ErrorBox error={error} />
        {preview && !preview.ok && (
          <div className="border border-amber/60 bg-amber/10 rounded-md p-3 text-[13px] space-y-1">
            {preview.problems.map((p, i) => (
              <div key={i}>{p}</div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {preview ? <FrameBudgetBar budget={preview.frame_budget} /> : <div className="panel p-3 text-muted">Pick an angle to see the frame budget.</div>}
        <div className="panel p-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-muted">Estimated cost</span>
            <span className="num text-[18px]">{preview ? inr(preview.estimate.total) : "—"}</span>
          </div>
          {preview && (
            <div className="text-[12px] text-muted space-y-0.5">
              {Object.entries(preview.estimate.breakdown).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span className="num">{inr(v)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-1 border-t border-hairline">
                <span>envelope</span>
                <span className="num">{inr(preview.envelope_inr)}</span>
              </div>
              <div className="flex justify-between">
                <span>eligible evidence</span>
                <span className="num">
                  {preview.eligible_evidence} (need ≥ {preview.min_evidence})
                </span>
              </div>
            </div>
          )}
          <button className="btn btn-primary w-full justify-center h-10" disabled={!canGenerate} onClick={generate}>
            {busy ? "Locking recipe…" : `Generate ${preview ? inr(preview.estimate.total) : ""}`}
          </button>
          <div className="text-[12px] text-faint">Locks an immutable recipe and enqueues a job. Nothing is charged until a model is called.</div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-[12px] text-muted uppercase tracking-wide w-24 pt-2 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
