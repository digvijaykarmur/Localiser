import {
  boxInside,
  boxInsideCanvas,
  CANVAS,
  peakVelocityFrac,
  safeBox,
  TEXT_LAYER_TYPES,
  treatmentViolations,
  MAX_CROP_VELOCITY_FRAC_PER_S,
  type CheckResult,
  type DeterministicReport,
  type EvidenceUnit,
  type PromoPlan,
  type Ratio,
  type Recipe,
  type Script,
  type Timeline,
  type Title,
} from "@/domain";
import { ffprobeJson, parseFps, run } from "@/lib/ffmpeg";
import type { AssetProvenance } from "@/db/schema";

/**
 * D1–D17 (§31.1). No model involved: ffprobe + ffmpeg analysis filters + arithmetic.
 * This module must never import a model provider (enforced by eslint).
 */
export interface DeterministicInput {
  ratio: Ratio;
  renderPath: string;
  timeline: Timeline;
  plan: PromoPlan;
  script: Script;
  recipe: Recipe;
  title: Title;
  evidence: Map<string, EvidenceUnit>;
  assetRows: { id: string; kind: string; storageKey: string; provenance: AssetProvenance; localPath: string }[];
  costSpentInr: number;
}

export async function runDeterministicChecks(i: DeterministicInput): Promise<DeterministicReport> {
  const checks: CheckResult[] = [];
  const probe = await ffprobeJson(i.renderPath);
  const v = probe.streams.find((s) => s.codec_type === "video");
  const durationMs = Math.round(Number(probe.format.duration ?? 0) * 1000);
  const targetMs = i.recipe.duration_s * 1000;

  checks.push({ id: "D1", pass: Math.abs(durationMs - targetMs) <= 300, detail: `duration ${durationMs}ms vs target ${targetMs}ms`, measured: durationMs });

  const c = CANVAS[i.ratio];
  const fps = parseFps(v?.r_frame_rate);
  checks.push({ id: "D2", pass: v?.width === c.w && v?.height === c.h && Math.abs(fps - 30) < 0.01, detail: `${v?.width}×${v?.height} @ ${fps.toFixed(2)}fps (want ${c.w}×${c.h} @ 30)`, measured: `${v?.width}x${v?.height}@${fps}` });

  // D3: output has audio, and every declared track's asset has an audio stream
  let d3 = probe.streams.some((s) => s.codec_type === "audio");
  const missing: string[] = [];
  const probed = new Map<string, boolean>();
  for (const t of i.timeline.audio) {
    const row = i.assetRows.find((a) => a.id === t.asset_id);
    if (!row) {
      missing.push(`${t.id}: asset ${t.asset_id} missing`);
      continue;
    }
    let ok = probed.get(row.id);
    if (ok === undefined) {
      try {
        ok = (await ffprobeJson(row.localPath)).streams.some((s) => s.codec_type === "audio");
      } catch {
        ok = false;
      }
      probed.set(row.id, ok);
    }
    if (!ok) missing.push(`${t.id}: no audio stream in ${row.kind}`);
  }
  d3 = d3 && missing.length === 0;
  checks.push({ id: "D3", pass: d3, detail: d3 ? `${i.timeline.audio.length} tracks, all with audio` : missing.join("; ") || "render has no audio stream" });

  // D4/D5: loudness + true peak from a loudnorm measurement pass
  const loud = await measure(i.renderPath);
  checks.push({ id: "D4", pass: loud.i !== null && Math.abs(loud.i + 14) <= 1.0, detail: `integrated ${loud.i?.toFixed(2)} LUFS (want −14 ±1)`, measured: loud.i });
  checks.push({ id: "D5", pass: loud.tp !== null && loud.tp <= -1.0 + 0.05, detail: `true peak ${loud.tp?.toFixed(2)} dBTP (want ≤ −1.0)`, measured: loud.tp });

  // D6/D7: silence and black runs
  const { silenceMs, blackMs } = await detectRuns(i.renderPath);
  checks.push({ id: "D6", pass: silenceMs <= 1200, detail: `longest silence ${silenceMs}ms (≤1200)`, measured: silenceMs });
  checks.push({ id: "D7", pass: blackMs <= 400, detail: `longest black run ${blackMs}ms (≤400)`, measured: blackMs });

  // D8: text boxes inside safe area
  const sb = safeBox(i.ratio);
  const unsafe = i.timeline.layers.filter((l) => TEXT_LAYER_TYPES.has(l.type) && !boxInside(l.dest, sb)).map((l) => l.id);
  checks.push({ id: "D8", pass: unsafe.length === 0, detail: unsafe.length ? `outside safe area: ${unsafe.join(", ")}` : `all text boxes inside safe area (${sb.x},${sb.y},${sb.w}×${sb.h})` });

  // D9: dest boxes inside canvas
  const outside = i.timeline.layers.filter((l) => !boxInsideCanvas(l.dest, i.ratio)).map((l) => l.id);
  checks.push({ id: "D9", pass: outside.length === 0, detail: outside.length ? `outside canvas: ${outside.join(", ")}` : "all layers inside canvas" });

  // D10: evidence resolves
  const unresolved = i.plan.beats.flatMap((b) => b.evidence_ids.filter((id) => !i.evidence.has(id)).map((id) => `beat ${b.index}: ${id}`));
  checks.push({ id: "D10", pass: unresolved.length === 0 && i.plan.beats.every((b) => b.evidence_ids.length >= 1), detail: unresolved.length ? unresolved.join("; ") : "every beat cites resolvable evidence" });

  // D11: spoiler boundary
  const late = i.plan.beats.flatMap((b) => b.evidence_ids.map((id) => i.evidence.get(id)).filter((e): e is EvidenceUnit => !!e && (e.start_ms >= i.title.spoiler_boundary_ms || e.is_spoiler)).map((e) => e.id));
  checks.push({ id: "D11", pass: late.length === 0, detail: late.length ? `after boundary or spoiler: ${late.join(", ")}` : `all evidence before ${i.title.spoiler_boundary_ms}ms and non-spoiler` });

  // D12: word budget
  checks.push({ id: "D12", pass: i.script.within_budget && i.script.total_words <= Math.max(i.script.budget_words, 0), detail: `${i.script.total_words} words / budget ${i.script.budget_words}`, measured: i.script.total_words });

  // D13: cost
  checks.push({ id: "D13", pass: i.costSpentInr <= i.recipe.cost_envelope_inr, detail: `₹${i.costSpentInr.toFixed(2)} of ₹${i.recipe.cost_envelope_inr}`, measured: i.costSpentInr });

  // D14: intensity monotonic STAKE→ESCALATE
  const ordered = i.plan.beats.filter((b) => b.role !== "HOOK" && b.role !== "CTA");
  let drop: string | null = null;
  for (let k = 1; k < ordered.length; k++) if (ordered[k]!.intensity < ordered[k - 1]!.intensity) drop = `drops at beat ${ordered[k]!.index}`;
  checks.push({ id: "D14", pass: drop === null, detail: drop ?? `intensity ${ordered.map((b) => b.intensity).join("→")}` });

  // D15: tracked crop velocity
  const fast = i.timeline.layers.filter((l) => l.crop_keyframes && peakVelocityFrac(l.crop_keyframes) > MAX_CROP_VELOCITY_FRAC_PER_S).map((l) => l.id);
  checks.push({ id: "D15", pass: fast.length === 0, detail: fast.length ? `too fast: ${fast.join(", ")}` : "all tracked crops ≤ 8% width/s" });

  // D16: treatment matrix
  const violations = treatmentViolations(
    i.plan.beats.filter((b) => b.role !== "CTA").map((b) => ({ index: b.index, treatment: b.treatment, shots: b.evidence_ids.map((id) => i.evidence.get(id)?.shot_type).filter((s): s is EvidenceUnit["shot_type"] => !!s) })),
    i.ratio,
  );
  checks.push({ id: "D16", pass: violations.length === 0, detail: violations.length ? violations.join("; ") : "treatment matrix respected" });

  // D17: provenance complete on every asset referenced
  const referenced = new Set([...i.timeline.layers.map((l) => l.asset_id), ...i.timeline.audio.map((a) => a.asset_id)].filter((x): x is string => !!x));
  const bad = i.assetRows.filter((a) => referenced.has(a.id) && (!a.provenance?.provider || !a.provenance?.input_hash || ((a.provenance.provider === "vertex" || a.provenance.provider === "elevenlabs") && !a.provenance.model))).map((a) => a.id);
  checks.push({ id: "D17", pass: bad.length === 0 && [...referenced].every((id) => i.assetRows.some((a) => a.id === id)), detail: bad.length ? `incomplete provenance: ${bad.join(", ")}` : `${referenced.size} assets with provenance` });

  return { ratio: i.ratio, checks, all_pass: checks.every((c) => c.pass) };
}

async function measure(file: string): Promise<{ i: number | null; tp: number | null }> {
  const r = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"]);
  const m = /\{[\s\S]*\}/.exec(r.stderr);
  if (!m) return { i: null, tp: null };
  const j = JSON.parse(m[0]) as { input_i: string; input_tp: string };
  const i = Number(j.input_i);
  const tp = Number(j.input_tp);
  return { i: Number.isFinite(i) ? i : null, tp: Number.isFinite(tp) ? tp : null };
}

async function detectRuns(file: string): Promise<{ silenceMs: number; blackMs: number }> {
  const r = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-vf", "blackdetect=d=0.05:pix_th=0.08", "-af", "silencedetect=n=-45dB:d=0.3", "-f", "null", "-"]);
  let silenceMs = 0;
  let blackMs = 0;
  for (const m of r.stderr.matchAll(/silence_duration:\s*([\d.]+)/g)) silenceMs = Math.max(silenceMs, Math.round(Number(m[1]) * 1000));
  for (const m of r.stderr.matchAll(/black_duration:\s*([\d.]+)/g)) blackMs = Math.max(blackMs, Math.round(Number(m[1]) * 1000));
  return { silenceMs, blackMs };
}
