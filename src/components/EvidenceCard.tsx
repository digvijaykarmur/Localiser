import type { EvidenceUnit } from "@/domain";
import type { ShotType } from "@/domain/evidence";
import { ms } from "./lib/api";

/** Coloured left rule encodes shot type; the hatch encodes croppable_916 === false (§28.2). */
export const SHOT_COLOUR: Record<ShotType, string> = {
  ECU: "#C2453F",
  CU: "#D1742F",
  MCU: "#C9A227",
  MS: "#2E9E5B",
  TWO_SHOT: "#3D7EFF",
  GROUP: "#7B61FF",
  WIDE: "#5A8FA8",
  INSERT: "#8B8B95",
  ACTION: "#E05FA0",
};

export function EvidenceCard({ unit: u, dim = false, onClick }: { unit: EvidenceUnit; dim?: boolean; onClick?: () => void }) {
  const state = !u.usable ? "unusable" : u.is_spoiler ? "spoiler" : !u.croppable_916 ? "not-croppable" : "usable";
  return (
    <button onClick={onClick} className={`panel text-left overflow-hidden flex hover:border-muted transition-colors ${dim ? "opacity-40" : ""}`} title={u.crop_note ?? u.unusable_reason ?? undefined}>
      <div className="w-1 shrink-0" style={{ background: SHOT_COLOUR[u.shot_type] }} />
      <div className="flex-1 min-w-0">
        <div className="relative aspect-video bg-surface">
          {u.frame_urls[1] && <img src={u.frame_urls[1]} alt="" className="w-full h-full object-cover" loading="lazy" />}
          {!u.croppable_916 && <div className="absolute inset-0 hatch pointer-events-none" />}
          {state === "unusable" && <div className="absolute inset-0 bg-surface/80 flex items-center justify-center text-[12px] text-muted">unusable · {u.unusable_reason}</div>}
          {u.is_spoiler && <span className="absolute top-1 right-1 chip bg-surface/90 text-rejected border-rejected/40">spoiler</span>}
          {u.subject_boxes.slice(0, 6).map((b, i) => (
            <div key={i} className="absolute border pointer-events-none" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, borderColor: b.is_speaking ? "#3D7EFF" : "rgba(232,232,236,0.5)" }} />
          ))}
        </div>
        <div className="p-2 space-y-1">
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span className="num">
              {ms(u.start_ms)} – {ms(u.end_ms)}
            </span>
            <span className="text-ink" style={{ color: SHOT_COLOUR[u.shot_type] }}>
              {u.shot_type}
            </span>
          </div>
          <div className="text-[13px] leading-snug line-clamp-2" title={u.description}>
            {u.description}
          </div>
          {u.dialogue_native && <div className="native text-[15px] text-muted line-clamp-1">{u.dialogue_native}</div>}
          <div className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1 text-muted">
              intensity
              <span className="tracking-[-1px] text-ink">
                {"●".repeat(u.intensity)}
                <span className="text-faint">{"○".repeat(10 - u.intensity)}</span>
              </span>
              <span className="num">{u.intensity}</span>
            </span>
            <span className="flex gap-2">
              <span className={u.croppable_11 ? "text-approved" : "text-rejected"}>1:1 {u.croppable_11 ? "✓" : "✗"}</span>
              <span className={u.croppable_916 ? "text-approved" : "text-rejected"}>9:16 {u.croppable_916 ? "✓" : "✗"}</span>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
