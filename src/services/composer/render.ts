import fs from "node:fs/promises";
import type { Timeline } from "@/domain";
import { ffmpeg, ffprobeJson, run } from "@/lib/ffmpeg";
import { log } from "@/lib/log";
import { timelineToArgs } from "./timelineToArgs";

const logger = log("render");

export interface LoudnessMeasure {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** First loudnorm pass: measure only (§24.3). */
export async function measureLoudness(file: string): Promise<LoudnessMeasure> {
  const r = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"]);
  const m = /\{[\s\S]*\}/.exec(r.stderr);
  if (!m) throw new Error(`loudnorm measurement produced no JSON: ${r.stderr.slice(-500)}`);
  const j = JSON.parse(m[0]) as LoudnessMeasure;
  return j;
}

/** Second pass: apply measured values linearly; video copied; promo_id metadata written. */
export async function applyLoudness(input: string, output: string, m: LoudnessMeasure, promoId: string): Promise<void> {
  const af = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
  await ffmpeg(["-i", input, "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-metadata", `comment=promo_id=${promoId}`, output]);
}

/** S7b — render a Timeline to disk: composite → measure → normalise. Returns final path. */
export async function renderTimeline(t: Timeline, assets: Map<string, string>, opts: { rawOut: string; finalOut: string; promoId: string; preset?: string }): Promise<{ args: string[]; loudness: LoudnessMeasure }> {
  const args = timelineToArgs(t, assets, { out: `${opts.rawOut}.partial.mp4`, promoId: opts.promoId, preset: opts.preset });
  logger.info("ffmpeg composite", { ratio: t.ratio, inputs: args.filter((a) => a === "-i").length, out: opts.rawOut });
  await ffmpeg(args);
  await fs.rename(`${opts.rawOut}.partial.mp4`, opts.rawOut);
  const loudness = await measureLoudness(opts.rawOut);
  await applyLoudness(opts.rawOut, `${opts.finalOut}.partial.mp4`, loudness, opts.promoId);
  await fs.rename(`${opts.finalOut}.partial.mp4`, opts.finalOut);
  const probe = await ffprobeJson(opts.finalOut);
  logger.info("render complete", { ratio: t.ratio, duration: probe.format.duration });
  return { args, loudness };
}

export { timelineToArgs };
