"use client";

import { useMemo, useState } from "react";
import type { Box, Layer, Timeline } from "@/domain/timeline";
import { CANVAS, MASTER, type Ratio } from "@/domain/primitives";
import { SAFE_AREA, safeBox } from "@/domain/geometry";
import { ms } from "./lib/api";

const LAYER_COLOUR: Record<Layer["type"], string> = {
  source_clip: "#3D7EFF",
  generated_video: "#9B6CFF",
  image: "#2E9E5B",
  solid: "#5A5A64",
  caption_card: "#C9A227",
  cta_card: "#D1742F",
};
const AUDIO_COLOUR: Record<string, string> = { source: "#3D7EFF", vo: "#C9A227", music: "#2E9E5B", sfx: "#9B6CFF" };

function cropAt(layer: Layer, tMs: number): Box | null {
  if (layer.src_crop) return layer.src_crop;
  const kf = layer.crop_keyframes;
  if (!kf || kf.length === 0) return null;
  const rel = tMs - layer.start_ms;
  if (rel <= kf[0]!.t_ms) return kf[0]!.box;
  for (let i = 1; i < kf.length; i++) {
    const a = kf[i - 1]!;
    const b = kf[i]!;
    if (rel <= b.t_ms) {
      const f = (rel - a.t_ms) / Math.max(1, b.t_ms - a.t_ms);
      return { x: Math.round(a.box.x + (b.box.x - a.box.x) * f), y: Math.round(a.box.y + (b.box.y - a.box.y) * f), w: a.box.w, h: a.box.h };
    }
  }
  return kf[kf.length - 1]!.box;
}

/**
 * Timeline Inspector (§28.3): the Timeline JSON rendered visually *before* ffmpeg runs.
 * Bars per layer on a time axis · canvas preview at the scrub position with every dest box outlined
 * and the safe-area mask in red · raw JSON beside it with the hovered layer highlighted.
 */
export function TimelineInspector({ timeline }: { timeline: Timeline }) {
  const [t, setT] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const ratio = timeline.ratio as Ratio;
  const canvas = CANVAS[ratio];
  const safe = safeBox(ratio);
  const sa = SAFE_AREA[ratio];
  const dur = timeline.duration_ms;

  const layers = useMemo(() => [...timeline.layers].sort((a, b) => a.z - b.z), [timeline.layers]);
  const active = layers.filter((l) => t >= l.start_ms && t < l.end_ms);
  const hovered = layers.find((l) => l.id === hover) ?? null;
  const cropLayer = (hovered && (hovered.src_crop || hovered.crop_keyframes) ? hovered : null) ?? active.find((l) => l.src_crop || l.crop_keyframes) ?? null;
  const crop = cropLayer ? cropAt(cropLayer, t) : null;
  const previewH = 420;
  const previewW = Math.round((previewH * canvas.w) / canvas.h);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div>
            <svg width={previewW} height={previewH} viewBox={`0 0 ${canvas.w} ${canvas.h}`} className="bg-black rounded border border-hairline block" aria-label="Canvas preview at scrub position">
              {active.map((l) => {
                const c = LAYER_COLOUR[l.type];
                const on = hover === l.id;
                return (
                  <g key={l.id} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                    <rect x={l.dest.x} y={l.dest.y} width={l.dest.w} height={l.dest.h} fill={c} fillOpacity={l.type === "solid" ? 0.35 : on ? 0.22 : 0.1} stroke={c} strokeWidth={on ? 10 : 5} />
                    <text x={l.dest.x + 18} y={l.dest.y + 46} fill={c} fontSize={38} fontFamily="Inter, sans-serif">
                      {l.type} · z{l.z}
                    </text>
                  </g>
                );
              })}
              {/* safe-area mask (§19.5) */}
              <g fill="#C2453F" fillOpacity={0.28} pointerEvents="none">
                <rect x={0} y={0} width={canvas.w} height={sa.top} />
                <rect x={0} y={canvas.h - sa.bottom} width={canvas.w} height={sa.bottom} />
                <rect x={0} y={sa.top} width={sa.sides} height={canvas.h - sa.top - sa.bottom} />
                <rect x={canvas.w - sa.sides} y={sa.top} width={sa.sides} height={canvas.h - sa.top - sa.bottom} />
              </g>
              <rect x={safe.x} y={safe.y} width={safe.w} height={safe.h} fill="none" stroke="#C2453F" strokeWidth={3} strokeDasharray="18 12" pointerEvents="none" />
            </svg>
            <div className="text-[12px] text-muted mt-1 num">
              {canvas.w}×{canvas.h} · t = {ms(t)}.{String(Math.floor((t % 1000) / 100))} · {active.length} layer{active.length === 1 ? "" : "s"} active · red = reserved
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[12px] text-muted">Master crop window {cropLayer ? `· ${cropLayer.id}` : "· no crop active"}</div>
            <svg width={256} height={144} viewBox={`0 0 ${MASTER.w} ${MASTER.h}`} className="bg-panel2 rounded border border-hairline block">
              <rect x={0} y={0} width={MASTER.w} height={MASTER.h} fill="#1C1C20" />
              <line x1={0} y1={0} x2={MASTER.w} y2={MASTER.h} stroke="#2A2A30" strokeWidth={4} />
              <line x1={MASTER.w} y1={0} x2={0} y2={MASTER.h} stroke="#2A2A30" strokeWidth={4} />
              {crop && <rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="#3D7EFF" fillOpacity={0.25} stroke="#3D7EFF" strokeWidth={12} />}
            </svg>
            {crop && (
              <div className="text-[12px] text-muted num">
                crop {crop.w}×{crop.h} @ {crop.x},{crop.y}
                {cropLayer?.crop_keyframes ? ` · ${cropLayer.crop_keyframes.length} keyframes (tracked)` : " · static"}
              </div>
            )}
            {!crop && <div className="text-[12px] text-faint">Whole frame used — nothing is cut.</div>}
          </div>
        </div>

        <div>
          <input type="range" min={0} max={dur} step={100} value={t} onChange={(e) => setT(Number(e.target.value))} className="w-full accent-[#3D7EFF]" aria-label="Scrub" />
          <div className="relative mt-1 space-y-1" onMouseLeave={() => setHover(null)}>
            {layers.map((l) => (
              <TrackBar key={l.id} id={l.id} label={`${l.type}${l.asset_id ? ` · ${l.asset_id}` : ""}`} start={l.start_ms} end={l.end_ms} dur={dur} colour={LAYER_COLOUR[l.type]} hovered={hover === l.id} onHover={setHover} />
            ))}
            <div className="border-t border-hairline my-1" />
            {timeline.audio.map((a) => (
              <TrackBar key={a.id} id={a.id} label={`♪ ${a.role} · ${a.gain_db}dB${a.duck_against ? ` · ducks vs ${a.duck_against}` : ""}`} start={a.start_ms} end={a.start_ms + (a.source_out_ms - a.source_in_ms)} dur={dur} colour={AUDIO_COLOUR[a.role] ?? "#8B8B95"} hovered={hover === a.id} onHover={setHover} />
            ))}
            <div className="absolute top-0 bottom-0 w-px bg-ink pointer-events-none" style={{ left: `calc(180px + (100% - 180px) * ${t / Math.max(1, dur)})` }} />
          </div>
        </div>
      </div>

      <aside className="panel p-2 overflow-auto max-h-[720px] text-[11px] font-mono">
        <div className="text-muted mb-1">
          timeline · {timeline.ratio} · {timeline.width}×{timeline.height} · {timeline.fps}fps · {timeline.duration_ms}ms
        </div>
        {layers.map((l) => (
          <pre key={l.id} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)} className={`rounded px-1 py-0.5 whitespace-pre-wrap break-all ${hover === l.id ? "bg-accent/20 text-ink" : "text-muted"}`}>
            {JSON.stringify(l)}
          </pre>
        ))}
        <div className="text-muted mt-2 mb-1">audio</div>
        {timeline.audio.map((a) => (
          <pre key={a.id} onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)} className={`rounded px-1 py-0.5 whitespace-pre-wrap break-all ${hover === a.id ? "bg-accent/20 text-ink" : "text-muted"}`}>
            {JSON.stringify(a)}
          </pre>
        ))}
      </aside>
    </div>
  );
}

function TrackBar({ id, label, start, end, dur, colour, hovered, onHover }: { id: string; label: string; start: number; end: number; dur: number; colour: string; hovered: boolean; onHover: (id: string | null) => void }) {
  return (
    <div className="flex items-center gap-2 h-5" onMouseEnter={() => onHover(id)}>
      <div className={`w-[172px] shrink-0 truncate text-[11px] ${hovered ? "text-ink" : "text-muted"}`} title={id}>
        {label}
      </div>
      <div className="relative flex-1 h-full bg-panel rounded">
        <div className="absolute top-0.5 bottom-0.5 rounded" style={{ left: `${(start / dur) * 100}%`, width: `${((end - start) / dur) * 100}%`, background: colour, opacity: hovered ? 1 : 0.7 }} title={`${ms(start)} – ${ms(end)}`} />
      </div>
    </div>
  );
}
