import type { AudioTrack, CropKeyframe, Layer, Timeline } from "@/domain";

function n(x: number): string {
  if (Number.isInteger(x)) return String(x);
  const s = x.toFixed(4);
  return s.replace(/\.?0+$/, "");
}

function sec(ms: number): string {
  return n(ms / 1000);
}

function cropExpr(keyframes: CropKeyframe[], field: "x" | "y" | "w" | "h"): string {
  if (keyframes.length === 0) return "0";
  if (keyframes.length === 1) return n(keyframes[0]!.box[field]);
  const sorted = [...keyframes].sort((a, b) => a.t_ms - b.t_ms);
  let expr = n(sorted[sorted.length - 1]!.box[field]);
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const t0 = n(a.t_ms / 1000);
    const t1 = n(b.t_ms / 1000);
    const v0 = n(a.box[field]);
    const v1 = n(b.box[field]);
    const dt = n(Math.max(0.001, (b.t_ms - a.t_ms) / 1000));
    const lerp = `${v0}+(${v1}-${v0})*(t-${t0})/${dt}`;
    expr = `if(between(t\\,${t0}\\,${t1})\\,${lerp}\\,${expr})`;
  }
  return expr;
}

function videoFilter(layer: Layer, inputIndex: number, label: string): string {
  const filters: string[] = ["setpts=PTS-STARTPTS"];
  if (layer.crop_keyframes && layer.crop_keyframes.length) {
    filters.push(
      `crop=${cropExpr(layer.crop_keyframes, "w")}:${cropExpr(layer.crop_keyframes, "h")}:${cropExpr(layer.crop_keyframes, "x")}:${cropExpr(layer.crop_keyframes, "y")}`,
    );
  } else if (layer.src_crop) {
    const c = layer.src_crop;
    filters.push(`crop=${c.w}:${c.h}:${c.x}:${c.y}`);
  }
  filters.push(`scale=${layer.dest.w}:${layer.dest.h}`);
  if (layer.opacity < 1) filters.push(`format=rgba,colorchannelmixer=aa=${n(layer.opacity)}`);
  return `[${inputIndex}:v]${filters.join(",")}[${label}]`;
}

export function timelineToFiltergraph(
  t: Timeline,
  resolveAsset: (id: string) => string,
): { args: string[] } {
  const durationS = sec(t.duration_ms);
  const visual = t.layers
    .filter((l) => l.type !== "solid")
    .sort((a, b) => a.z - b.z || a.start_ms - b.start_ms);

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  const visualMeta: { label: string; layer: Layer; inputIndex: number }[] = [];
  let inputIndex = 0;
  const audioInputIndex = new Map<string, number>();
  // Video inputs are trimmed per layer and must not be reused for audio.

  for (const layer of visual) {
    if (!layer.asset_id) continue;
    const file = resolveAsset(layer.asset_id);
    if (layer.type === "image" || layer.type === "caption_card" || layer.type === "cta_card") {
      const d = Math.max(0.05, (layer.end_ms - layer.start_ms) / 1000);
      args.push("-loop", "1", "-framerate", "30", "-t", n(d), "-i", file);
    } else {
      const ss = layer.source_in_ms ?? 0;
      const dur = (layer.source_out_ms ?? layer.end_ms) - ss;
      args.push("-ss", sec(ss), "-t", sec(Math.max(1, dur)), "-i", file);
    }
    visualMeta.push({ label: `v${visualMeta.length}`, layer, inputIndex });
    inputIndex += 1;
  }

  for (const tr of t.audio) {
    args.push("-i", resolveAsset(tr.asset_id));
    audioInputIndex.set(tr.id, inputIndex);
    inputIndex += 1;
  }

  const bg = t.layers.find((l) => l.type === "solid");
  const color = (bg?.fill_color ?? "#141416").replace("#", "0x");
  const fc: string[] = [`color=c=${color}:s=${t.width}x${t.height}:d=${durationS}:r=${t.fps}[base]`];

  for (const m of visualMeta) fc.push(videoFilter(m.layer, m.inputIndex, m.label));

  if (visualMeta.length === 0) {
    fc.push("[base]null[vout]");
  } else {
    let last = "base";
    visualMeta.forEach((m, i) => {
      const next = i === visualMeta.length - 1 ? "vout" : `o${i}`;
      const enable = `between(t,${sec(m.layer.start_ms)},${sec(m.layer.end_ms)})`;
      fc.push(`[${last}][${m.label}]overlay=${m.layer.dest.x}:${m.layer.dest.y}:enable='${enable}'[${next}]`);
      last = next;
    });
  }

  fc.push(audioFilters(t.audio, audioInputIndex, durationS));

  args.push("-filter_complex", fc.join(";"));
  args.push(
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-crf",
    "19",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-r",
    "30",
    "-movflags",
    "+faststart",
    "-t",
    durationS,
  );
  return { args };
}

function audioFilters(
  tracks: AudioTrack[],
  inputIndexByAsset: Map<string, number>,
  durationS: string,
): string {
  if (tracks.length === 0) {
    return `anullsrc=r=48000:cl=stereo,atrim=0:${durationS},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`;
  }
  const parts: string[] = [];
  const labelled: string[] = [];
  tracks.forEach((tr, i) => {
    const idx = inputIndexByAsset.get(tr.id);
    const lab = `a${i}`;
    const vol = n(Math.pow(10, tr.gain_db / 20));
    if (idx === undefined) {
      parts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${durationS}[${lab}]`);
    } else {
      const fade: string[] = [];
      if (tr.fade_in_ms) fade.push(`afade=t=in:st=0:d=${sec(tr.fade_in_ms)}`);
      if (tr.fade_out_ms) {
        const st = Math.max(0, (tr.source_out_ms - tr.source_in_ms - tr.fade_out_ms) / 1000);
        fade.push(`afade=t=out:st=${n(st)}:d=${sec(tr.fade_out_ms)}`);
      }
      parts.push(
        `[${idx}:a]atrim=start=${sec(tr.source_in_ms)}:end=${sec(tr.source_out_ms)},asetpts=PTS-STARTPTS,adelay=${tr.start_ms}|${tr.start_ms},volume=${vol}${fade.length ? "," + fade.join(",") : ""}[${lab}]`,
      );
    }
    labelled.push(lab);
  });

  let mixInputs = [...labelled];
  tracks.forEach((tr, duckIdx) => {
    if (!tr.duck_against) return;
    const srcIdx = tracks.findIndex((x) => x.id === tr.duck_against);
    if (srcIdx < 0) return;
    const ducked = `ad${duckIdx}`;
    parts.push(
      `[${labelled[duckIdx]!}][${labelled[srcIdx]!}]sidechaincompress=threshold=0.05:ratio=8:attack=50:release=200[${ducked}]`,
    );
    mixInputs[duckIdx] = ducked;
  });

  if (mixInputs.length === 1) {
    parts.push(
      `[${mixInputs[0]}]loudnorm=I=-14:TP=-1.5:LRA=11,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`,
    );
  } else {
    parts.push(
      `${mixInputs.map((l) => `[${l}]`).join("")}amix=inputs=${mixInputs.length}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`,
    );
  }
  return parts.join(";");
}

export function filtergraphSnapshot(t: Timeline): string[] {
  const { args } = timelineToFiltergraph(t, (assetId) => `assets/${assetId}`);
  return args;
}
