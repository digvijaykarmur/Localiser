import type { Angle, EvidenceUnit } from "@/domain";
import { SHOT_COLOUR } from "./EvidenceCard";

/** States: vertical-feasible · vertical-hard (§28.4). Evidence strip beneath (§7.1 ②). */
export function AngleCard({ angle: a, evidence, selected, onSelect }: { angle: Angle; evidence: EvidenceUnit[]; selected: boolean; onSelect: () => void }) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const units = a.evidence_ids.map((id) => byId.get(id)).filter((e): e is EvidenceUnit => !!e);
  return (
    <div className={`panel p-3 space-y-2 ${selected ? "border-accent" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[12px] text-muted uppercase tracking-wide">{a.kind}</div>
          <div className="text-[15px] leading-snug">{a.claim}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`chip ${a.vertical_feasible ? "text-approved border-approved/40" : "text-amber border-amber/40"}`}>{a.vertical_feasible ? "vertical feasible" : "vertical hard"}</span>
          {!a.spoiler_safe && <span className="chip text-rejected border-rejected/40">spoiler</span>}
        </div>
      </div>
      <div className="text-[12px] text-muted">{a.audience_note}</div>
      <div className="flex gap-1">
        {units.map((u) => (
          <div key={u.id} className={`relative w-16 aspect-video bg-surface overflow-hidden rounded-sm ${a.hook_candidate_ids.includes(u.id) ? "ring-1 ring-accent" : ""}`} title={`${u.id} · ${u.shot_type} · intensity ${u.intensity}${a.hook_candidate_ids.includes(u.id) ? " · hook candidate" : ""}`}>
            {u.frame_urls[1] && <img src={u.frame_urls[1]} alt="" className="w-full h-full object-cover" />}
            {!u.croppable_916 && <div className="absolute inset-0 hatch" />}
            <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: SHOT_COLOUR[u.shot_type] }} />
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button className={`btn btn-sm ${selected ? "btn-primary" : ""}`} onClick={onSelect}>
          {selected ? "Selected · Compose" : "Use this angle"}
        </button>
      </div>
    </div>
  );
}
