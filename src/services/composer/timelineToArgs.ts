import type { AudioTrack, Layer, Timeline } from "@/domain";
import { cropFilter, fmtNum } from "./keyframes";

export interface RenderOptions {
  out: string;
  promoId: string;
  /** encode preset; tests pin "medium" (§24.1 step 7) */
  preset?: string;
}

const sec = (ms: number) => fmtNum(ms / 1000);

/**
 * DTE (§3.3, §24): the renderer's only input is a validated Timeline. Same Timeline in, same
 * args out. Pure — no I/O; asset ids are resolved to paths by the caller.
 */
export function timelineToArgs(t: Timeline, assets: Map<string, string>, opts: RenderOptions): string[] {
  const inputs: string[] = [];
  const filters: string[] = [];
  let inputIdx = 0;

  const dur = sec(t.duration_ms);
  // 1. base
  inputs.push("-f", "lavfi", "-i", `color=c=black:s=${t.width}x${t.height}:r=${t.fps}:d=${dur}`);
  inputIdx++;
  let last = "base";
  filters.push(`[0:v]format=yuv420p[base]`);

  const assetPath = (id: string | null, layerId: string): string => {
    if (!id) throw new Error(`layer ${layerId} needs an asset`);
    const p = assets.get(id);
    if (!p) throw new Error(`asset ${id} for layer ${layerId} not resolved`);
    return p;
  };

  // 2–5. video layers, by z then id (stable)
  const layers = [...t.layers].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  layers.forEach((l, n) => {
    const layerDur = l.end_ms - l.start_ms;
    const label = `l${n}`;
    let chain: string[] = [];
    let srcLabel: string;

    if (l.type === "source_clip" || l.type === "generated_video") {
      const p = assetPath(l.asset_id, l.id);
      const inMs = l.source_in_ms ?? 0;
      const outMs = l.source_out_ms ?? inMs + layerDur;
      inputs.push("-ss", sec(inMs), "-to", sec(outMs), "-i", p);
      srcLabel = `[${inputIdx}:v]`;
      inputIdx++;
      chain.push("setpts=PTS-STARTPTS");
      if (l.crop_keyframes?.length) chain.push(cropFilter(l.crop_keyframes[0]!.box, l.crop_keyframes, null));
      else if (l.src_crop) chain.push(cropFilter(l.src_crop, null, l.src_crop));
      chain.push(`scale=${l.dest.w}:${l.dest.h}:flags=lanczos`, "setsar=1");
      const srcDur = outMs - inMs;
      if (srcDur < layerDur) chain.push(`tpad=stop_mode=clone:stop_duration=${sec(layerDur - srcDur)}`);
      chain.push(`trim=duration=${sec(layerDur)}`);
    } else if (l.type === "solid") {
      inputs.push("-f", "lavfi", "-i", `color=c=${(l.fill_color ?? "#000000").replace("#", "0x")}:s=${l.dest.w}x${l.dest.h}:r=${t.fps}:d=${sec(layerDur)}`);
      srcLabel = `[${inputIdx}:v]`;
      inputIdx++;
      chain.push("setpts=PTS-STARTPTS");
    } else {
      // image | caption_card | cta_card
      const p = assetPath(l.asset_id, l.id);
      inputs.push("-loop", "1", "-framerate", String(t.fps), "-t", sec(layerDur), "-i", p);
      srcLabel = `[${inputIdx}:v]`;
      inputIdx++;
      chain.push("setpts=PTS-STARTPTS");
      if (l.crop_keyframes?.length) chain.push(cropFilter(l.crop_keyframes[0]!.box, l.crop_keyframes, null));
      else if (l.src_crop) chain.push(cropFilter(l.src_crop, null, l.src_crop));
      chain.push(`scale=${l.dest.w}:${l.dest.h}:flags=lanczos`, "setsar=1", "format=rgba");
    }
    if (l.opacity < 1) chain.push(`format=rgba,colorchannelmixer=aa=${fmtNum(l.opacity)}`);
    chain.push(`setpts=PTS+${sec(l.start_ms)}/TB`);
    filters.push(`${srcLabel}${chain.join(",")}[${label}]`);
    const outLabel = `v${n}`;
    filters.push(`[${last}][${label}]overlay=${l.dest.x}:${l.dest.y}:eof_action=pass:enable='between(t,${sec(l.start_ms)},${sec(l.end_ms)})'[${outLabel}]`);
    last = outLabel;
    chain = [];
  });
  filters.push(`[${last}]format=yuv420p[vout]`);

  // 6. audio
  const tracks = [...t.audio].sort((a, b) => a.id.localeCompare(b.id));
  const trackLabel = new Map<string, string>();
  tracks.forEach((a, n) => {
    const p = assetPath(a.asset_id, a.id);
    inputs.push("-ss", sec(a.source_in_ms), "-to", sec(a.source_out_ms), "-i", p);
    const lbl = `a${n}`;
    const chain = audioChain(a, t.duration_ms);
    filters.push(`[${inputIdx}:a]${chain}[${lbl}]`);
    trackLabel.set(a.id, lbl);
    inputIdx++;
  });
  // ducking: split every duck target once per ducker
  const duckers = tracks.filter((a) => a.duck_against && trackLabel.has(a.duck_against));
  const splitCount = new Map<string, number>();
  for (const d of duckers) splitCount.set(d.duck_against!, (splitCount.get(d.duck_against!) ?? 0) + 1);
  const scLabels = new Map<string, string[]>();
  for (const [target, count] of splitCount) {
    const src = trackLabel.get(target)!;
    const outs = [`${src}m`, ...Array.from({ length: count }, (_, i) => `${src}sc${i}`)];
    filters.push(`[${src}]asplit=${count + 1}${outs.map((o) => `[${o}]`).join("")}`);
    trackLabel.set(target, `${src}m`);
    scLabels.set(target, outs.slice(1));
  }
  for (const d of duckers) {
    const sc = scLabels.get(d.duck_against!)!.shift()!;
    const src = trackLabel.get(d.id)!;
    filters.push(`[${src}][${sc}]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400:makeup=1[${src}d]`);
    trackLabel.set(d.id, `${src}d`);
  }
  const mixInputs = tracks.map((a) => `[${trackLabel.get(a.id)!}]`).join("");
  if (tracks.length === 1) filters.push(`${mixInputs}acopy[aout]`);
  else filters.push(`${mixInputs}amix=inputs=${tracks.length}:duration=longest:normalize=0[aout]`);

  // 7. output
  return [
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-t",
    dur,
    "-c:v",
    "libx264",
    "-crf",
    "19",
    "-preset",
    opts.preset ?? "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-r",
    String(t.fps),
    "-movflags",
    "+faststart",
    "-metadata",
    `comment=promo_id=${opts.promoId}`,
    opts.out,
  ];
}

function audioChain(a: AudioTrack, totalMs: number): string {
  const parts: string[] = ["asetpts=PTS-STARTPTS", "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"];
  const dur = a.source_out_ms - a.source_in_ms;
  if (a.gain_db !== 0) parts.push(`volume=${fmtNum(a.gain_db)}dB`);
  if (a.fade_in_ms > 0) parts.push(`afade=t=in:st=0:d=${sec(a.fade_in_ms)}`);
  if (a.fade_out_ms > 0) parts.push(`afade=t=out:st=${sec(Math.max(0, dur - a.fade_out_ms))}:d=${sec(a.fade_out_ms)}`);
  if (a.start_ms > 0) parts.push(`adelay=${a.start_ms}|${a.start_ms}`);
  parts.push(`apad=whole_dur=${sec(totalMs)}`, `atrim=0:${sec(totalMs)}`);
  return parts.join(",");
}

export type { Layer };
