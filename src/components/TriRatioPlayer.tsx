"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Ratio } from "@/domain/primitives";

const ORDER: Ratio[] = ["1:1", "9:16", "16:9"];
const DRIFT_MS = 60;

/**
 * Three synchronised players (§8). 9:16 in the centre and largest. Space plays all, R replays.
 * Sync is master-driven: the 9:16 element (or the first available) owns the clock; the others are
 * re-seeked whenever they drift past DRIFT_MS.
 */
/** Dispatched by VerdictBar when a bare `R` (no digit) is pressed on the review screen. */
export const REPLAY_EVENT = "promo:replay";

export function TriRatioPlayer({ renders, keyboard = "full", height = 420 }: { renders: Partial<Record<Ratio, string>>; keyboard?: "full" | "space" | "none"; height?: number }) {
  const refs = useRef<Partial<Record<Ratio, HTMLVideoElement | null>>>({});
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [t, setT] = useState(0);
  const master: Ratio = renders["9:16"] ? "9:16" : (ORDER.find((r) => renders[r]) ?? "9:16");

  const all = useCallback(() => ORDER.map((r) => refs.current[r]).filter((v): v is HTMLVideoElement => !!v), []);

  const playAll = useCallback(async () => {
    const vids = all();
    const m = refs.current[master];
    const at = m?.currentTime ?? 0;
    for (const v of vids) if (Math.abs(v.currentTime - at) > DRIFT_MS / 1000) v.currentTime = at;
    await Promise.all(vids.map((v) => v.play().catch(() => undefined)));
    setPlaying(true);
  }, [all, master]);

  const pauseAll = useCallback(() => {
    for (const v of all()) v.pause();
    setPlaying(false);
  }, [all]);

  const replay = useCallback(() => {
    for (const v of all()) v.currentTime = 0;
    void playAll();
  }, [all, playAll]);

  useEffect(() => {
    const m = refs.current[master];
    if (!m) return;
    const onTime = () => {
      setT(m.currentTime);
      for (const v of all()) if (v !== m && Math.abs(v.currentTime - m.currentTime) > DRIFT_MS / 1000) v.currentTime = m.currentTime;
    };
    const onEnd = () => setPlaying(false);
    m.addEventListener("timeupdate", onTime);
    m.addEventListener("ended", onEnd);
    return () => {
      m.removeEventListener("timeupdate", onTime);
      m.removeEventListener("ended", onEnd);
    };
  }, [all, master, renders]);

  useEffect(() => {
    if (keyboard === "none") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (playing) pauseAll();
        else void playAll();
      } else if (keyboard === "full" && (e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey) {
        replay();
      }
    };
    const onReplay = () => replay();
    window.addEventListener("keydown", onKey);
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(REPLAY_EVENT, onReplay);
    };
  }, [keyboard, playing, playAll, pauseAll, replay]);

  const seek = (sec: number) => {
    for (const v of all()) v.currentTime = sec;
    setT(sec);
  };
  const dur = refs.current[master]?.duration ?? 0;

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-center gap-4">
        {ORDER.map((r) => {
          const url = renders[r];
          const big = r === "9:16";
          const h = big ? height : Math.round(height * 0.62);
          const w = r === "9:16" ? Math.round((h * 9) / 16) : r === "1:1" ? h : Math.round((h * 16) / 9);
          return (
            <figure key={r} className="text-center">
              {url ? (
                <video
                  ref={(el) => {
                    refs.current[r] = el;
                  }}
                  src={url}
                  width={w}
                  height={h}
                  muted={muted || r !== master}
                  playsInline
                  preload="auto"
                  className="bg-black rounded border border-hairline block"
                  style={{ width: w, height: h }}
                  onClick={() => (playing ? pauseAll() : void playAll())}
                />
              ) : (
                <div className="bg-panel rounded border border-hairline border-dashed flex items-center justify-center text-faint text-[12px]" style={{ width: w, height: h }}>
                  no {r} render
                </div>
              )}
              <figcaption className={`mt-1 text-[12px] num ${big ? "text-ink" : "text-muted"}`}>{r}</figcaption>
            </figure>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn btn-sm" onClick={() => (playing ? pauseAll() : void playAll())}>
          {playing ? "❚❚ pause" : "▶ play all"} <span className="kbd">space</span>
        </button>
        <button className="btn btn-sm" onClick={replay}>
          ⟲ replay <span className="kbd">R</span>
        </button>
        <button className="btn btn-sm" onClick={() => setMuted((m) => !m)}>
          {muted ? "🔇 unmute" : "🔊 mute"}
        </button>
        <input type="range" min={0} max={dur || 1} step={0.05} value={Math.min(t, dur || 1)} onChange={(e) => seek(Number(e.target.value))} className="flex-1 accent-[#3D7EFF]" aria-label="Seek all" />
        <span className="num text-[12px] text-muted w-[84px] text-right">
          {t.toFixed(1)}s / {dur ? dur.toFixed(1) : "–"}s
        </span>
      </div>
    </div>
  );
}
