"use client";

import { useMemo, useState } from "react";
import type { EvidenceUnit } from "@/domain";
import { ShotType } from "@/domain/evidence";
import { EvidenceCard } from "./EvidenceCard";
import { ms } from "./lib/api";

/** Filters (§7.1 ①): shot type, intensity range, has dialogue, spoiler-safe, croppable at ratio. */
export function EvidenceGrid({ evidence, spoilerBoundaryMs }: { evidence: EvidenceUnit[]; spoilerBoundaryMs: number }) {
  const [shot, setShot] = useState<string>("");
  const [minI, setMinI] = useState(1);
  const [dialogue, setDialogue] = useState(false);
  const [safe, setSafe] = useState(false);
  const [crop, setCrop] = useState<"" | "1:1" | "9:16">("");
  const [open, setOpen] = useState<EvidenceUnit | null>(null);

  const shown = useMemo(
    () =>
      evidence.filter(
        (e) => (!shot || e.shot_type === shot) && e.intensity >= minI && (!dialogue || e.has_dialogue) && (!safe || (!e.is_spoiler && e.start_ms < spoilerBoundaryMs)) && (!crop || (crop === "1:1" ? e.croppable_11 : e.croppable_916)),
      ),
    [evidence, shot, minI, dialogue, safe, crop, spoilerBoundaryMs],
  );

  if (evidence.length === 0) return <div className="panel p-8 text-center text-muted">No evidence units. Build intelligence first.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-[13px]">
        <select className="input" value={shot} onChange={(e) => setShot(e.target.value)}>
          <option value="">All shots</option>
          {ShotType.options.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-muted">
          intensity ≥ <span className="text-ink num w-4">{minI}</span>
          <input type="range" min={1} max={10} value={minI} onChange={(e) => setMinI(Number(e.target.value))} />
        </label>
        <label className="chip cursor-pointer">
          <input type="checkbox" checked={dialogue} onChange={(e) => setDialogue(e.target.checked)} /> has dialogue
        </label>
        <label className="chip cursor-pointer">
          <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} /> spoiler-safe
        </label>
        <select className="input" value={crop} onChange={(e) => setCrop(e.target.value as "" | "1:1" | "9:16")}>
          <option value="">Any croppability</option>
          <option value="1:1">croppable 1:1</option>
          <option value="9:16">croppable 9:16</option>
        </select>
        <span className="text-muted ml-auto num">
          {shown.length} / {evidence.length}
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="panel p-8 text-center text-muted">No units match these filters.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {shown.map((u) => (
            <EvidenceCard key={u.id} unit={u} dim={u.start_ms >= spoilerBoundaryMs} onClick={() => setOpen(u)} />
          ))}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-6 z-50" onClick={() => setOpen(null)}>
          <div className="panel max-w-4xl w-full p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between">
              <div className="font-medium">
                {open.id} · {open.shot_type} · <span className="num">{ms(open.start_ms)}–{ms(open.end_ms)}</span>
              </div>
              <button className="btn btn-sm" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {open.frame_urls.map((f, i) => (
                <div key={i} className="relative aspect-video bg-surface">
                  <img src={f} alt="" className="w-full h-full object-cover" />
                  {!open.croppable_916 && <div className="absolute inset-0 hatch pointer-events-none" />}
                </div>
              ))}
            </div>
            <div className="text-[13px]">{open.description}</div>
            {open.dialogue_native && <div className="native">{open.dialogue_native}</div>}
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
              {[
                ["subjects", String(open.subject_count)],
                ["motion", open.motion],
                ["emotion", open.emotion.join(", ") || "—"],
                ["intensity", String(open.intensity)],
                ["usable", open.usable ? "yes" : `no · ${open.unusable_reason}`],
                ["spoiler", open.is_spoiler ? "yes" : "no"],
                ["croppable 1:1", open.croppable_11 ? "yes" : "no"],
                ["croppable 9:16", open.croppable_916 ? "yes" : `no · ${open.crop_note ?? ""}`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
