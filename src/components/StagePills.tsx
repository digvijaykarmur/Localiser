"use client";

export type StageState = "queued" | "running" | "done" | "failed" | "waiting-provider";
export interface StageView {
  stage: string;
  state: StageState;
  timing: { started_at?: string; finished_at?: string; ms?: number } | null;
}

const LABEL: Record<string, string> = { PLAN: "Plan", SCRIPT: "Script", ASSEMBLE: "Assemble", COMPOSE: "Compose", QC: "QC" };

/** Eight-stage strip (QUEUED and READY are implied by the ends); the current stage animates (§7.1 ⑤). */
export function StagePills({ stages, onSelect, selected }: { stages: StageView[]; onSelect?: (stage: string) => void; selected?: string | null }) {
  return (
    <ol className="flex items-center gap-1 flex-wrap">
      {stages.map((s, i) => {
        const cls =
          s.state === "done"
            ? "border-approved/60 text-ink"
            : s.state === "running"
              ? "border-accent text-ink stage-running"
              : s.state === "failed"
                ? "border-rejected text-rejected"
                : s.state === "waiting-provider"
                  ? "border-amber text-amber"
                  : "border-hairline text-faint";
        const clickable = s.state === "done" || s.state === "failed";
        return (
          <li key={s.stage} className="flex items-center gap-1">
            <button
              type="button"
              disabled={!clickable || !onSelect}
              onClick={() => onSelect?.(s.stage)}
              className={`h-7 px-2.5 rounded-full border text-[12px] font-medium ${cls} ${selected === s.stage ? "bg-panel2" : ""} disabled:cursor-default`}
              title={s.timing?.ms ? `${(s.timing.ms / 1000).toFixed(1)}s` : s.state}
            >
              <span className="mr-1 text-[10px] opacity-60">S{i + 4}</span>
              {LABEL[s.stage] ?? s.stage}
              {s.state === "done" && <span className="ml-1 text-approved">✓</span>}
              {s.state === "failed" && <span className="ml-1">✕</span>}
              {s.state === "waiting-provider" && <span className="ml-1">⏸</span>}
            </button>
            {i < stages.length - 1 && <span className="text-faint">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
