import { spawnSync } from "node:child_process";
import {
  boxInside,
  safeRect,
  CROP_VELOCITY_MAX_FRAC_PER_SEC,
  type DialectPack,
  type EvidenceUnit,
  type PromoPlan,
  type Recipe,
  type Script,
  type Timeline,
  DeterministicQcResult,
} from "@/domain";
import { maxCropVelocityFracPerSec } from "@/services/planner/tracked-crop";
import { runFfprobeJson } from "@/lib/ffmpeg";
import { scriptExceedsBudget } from "@/services/scripter";

function check(
  id: string,
  pass: boolean,
  detail: string,
): { id: string; pass: boolean; detail: string } {
  return { id, pass, detail };
}

export async function runDeterministicQc(args: {
  filePath: string;
  timeline: Timeline;
  plan: PromoPlan;
  recipe: Recipe;
  evidence: EvidenceUnit[];
  spoilerBoundary: number;
  script: Script | null;
  pack: DialectPack;
  costInr: number;
}): Promise<DeterministicQcResult> {
  const { filePath, timeline, plan, recipe, evidence, spoilerBoundary, script, pack, costInr } = args;
  const checks: { id: string; pass: boolean; detail: string }[] = [];
  const byId = new Map(evidence.map((e) => [e.id, e]));

  let durationMs = 0;
  let width = 0;
  let height = 0;
  let fps = 0;
  let hasAudio = false;
  try {
    const probe = await runFfprobeJson(filePath);
    durationMs = Math.round(Number(probe.format?.duration ?? 0) * 1000);
    const v = probe.streams?.find((s) => s.codec_type === "video");
    const a = probe.streams?.find((s) => s.codec_type === "audio");
    width = v?.width ?? 0;
    height = v?.height ?? 0;
    const [num, den] = (v?.avg_frame_rate ?? "30/1").split("/").map(Number);
    fps = den ? (num ?? 30) / den : Number(v?.avg_frame_rate ?? 30);
    hasAudio = Boolean(a);
  } catch (e) {
    checks.push(check("D1", false, `ffprobe failed: ${(e as Error).message}`));
  }

  const target = recipe.duration_s * 1000;
  checks.push(check("D1", Math.abs(durationMs - target) <= 300, `duration ${durationMs} vs ${target}`));
  checks.push(
    check(
      "D2",
      width === timeline.width && height === timeline.height && Math.abs(fps - 30) < 0.1,
      `got ${width}x${height}@${fps}`,
    ),
  );
  checks.push(check("D3", hasAudio, hasAudio ? "audio present" : "no audio stream"));

  const loud = probeLoudness(filePath);
  checks.push(
    check("D4", loud.lufs === null || Math.abs(loud.lufs - -14) <= 1.0, `lufs=${loud.lufs}`),
  );
  checks.push(check("D5", loud.tp === null || loud.tp <= -1.0, `true_peak=${loud.tp}`));

  const silence = probeSilence(filePath);
  checks.push(check("D6", silence <= 1200, `longest_silence_ms=${silence}`));
  const black = probeBlack(filePath);
  checks.push(check("D7", black <= 400, `longest_black_ms=${black}`));

  const safe = safeRect(timeline.ratio, timeline.width, timeline.height);
  const textLayers = timeline.layers.filter((l) => l.type === "caption_card" || l.type === "cta_card");
  const textOk = textLayers.every((l) => boxInside(l.dest, safe));
  checks.push(check("D8", textOk, textOk ? "text inside safe" : "text outside safe area"));

  const canvasOk = timeline.layers.every(
    (l) =>
      l.dest.x >= 0 &&
      l.dest.y >= 0 &&
      l.dest.x + l.dest.w <= timeline.width &&
      l.dest.y + l.dest.h <= timeline.height,
  );
  checks.push(check("D9", canvasOk, canvasOk ? "layers in canvas" : "layer dest outside canvas"));

  const idsOk = plan.beats.every(
    (b) => b.evidence_ids.length >= 1 && b.evidence_ids.every((id) => byId.has(id)),
  );
  checks.push(check("D10", idsOk, idsOk ? "evidence resolvable" : "missing evidence_ids"));

  const spoilerOk = plan.beats.every((b) =>
    b.evidence_ids.every((id) => {
      const u = byId.get(id);
      return u && u.start_ms < spoilerBoundary;
    }),
  );
  checks.push(check("D11", spoilerOk, spoilerOk ? "no spoiler evidence" : "evidence after spoiler boundary"));

  if (!script) {
    checks.push(check("D12", true, "no VO script"));
  } else {
    const over = scriptExceedsBudget(
      script.total_words,
      recipe.duration_s,
      script.cta_s,
      pack.rhythm.words_per_second,
    );
    checks.push(check("D12", !over, `words=${script.total_words} budget via wps=${pack.rhythm.words_per_second}`));
  }

  checks.push(
    check("D13", costInr <= recipe.cost_envelope_inr, `cost=${costInr} envelope=${recipe.cost_envelope_inr}`),
  );

  let prev = 0;
  let mono = true;
  for (const b of plan.beats) {
    if (b.role === "HOOK" || b.role === "CTA") continue;
    if (b.intensity < prev) mono = false;
    prev = b.intensity;
  }
  checks.push(check("D14", mono, mono ? "intensity monotonic" : "intensity decreased"));

  let velOk = true;
  let vel = 0;
  for (const l of timeline.layers) {
    if (!l.crop_keyframes?.length) continue;
    vel = Math.max(vel, maxCropVelocityFracPerSec(l.crop_keyframes));
    if (vel > CROP_VELOCITY_MAX_FRAC_PER_SEC + 1e-6) velOk = false;
  }
  checks.push(check("D15", velOk, `max_velocity_frac=${vel}`));

  return DeterministicQcResult.parse({
    pass: checks.every((c) => c.pass),
    checks,
  });
}

function probeLoudness(file: string): { lufs: number | null; tp: number | null } {
  const r = spawnSync(
    "ffmpeg",
    ["-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const text = `${r.stderr ?? ""}`;
  const summary = text.includes("Summary:") ? text.slice(text.lastIndexOf("Summary:")) : text;
  const i = summary.match(/I:\s+(-?[\d.]+)\s+LUFS/);
  const tp = summary.match(/Peak:\s+(-?[\d.]+)\s+dBFS/);
  return {
    lufs: i ? Number(i[1]) : null,
    tp: tp ? Number(tp[1]) : null,
  };
}

function probeSilence(file: string): number {
  const r = spawnSync(
    "ffmpeg",
    ["-i", file, "-af", "silencedetect=noise=-40dB:d=0.3", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const text = r.stderr ?? "";
  let max = 0;
  const re = /silence_duration:\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) max = Math.max(max, Number(m[1]) * 1000);
  return max;
}

function probeBlack(file: string): number {
  const r = spawnSync(
    "ffmpeg",
    ["-i", file, "-vf", "blackdetect=d=0.4:pix_th=0.02", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const text = r.stderr ?? "";
  let max = 0;
  const re = /black_duration:([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) max = Math.max(max, Number(m[1]) * 1000);
  return max;
}
