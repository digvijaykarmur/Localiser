import type { Ratio, Treatment } from "@/domain";

export type FrameBudgetView = Record<Ratio, { croppable_fraction: number; composition_first: boolean; chosen_composition: Treatment | null }>;

/** Three bars + composition note (§7.1 ③). Shown before generation, at zero cost. */
export function FrameBudgetBar({ budget }: { budget: FrameBudgetView }) {
  const rows: Ratio[] = ["16:9", "1:1", "9:16"];
  return (
    <div className="panel p-3 space-y-2">
      <div className="text-[12px] text-muted uppercase tracking-wide">Frame budget</div>
      {rows.map((r) => {
        const b = budget[r];
        const pctv = Math.round(b.croppable_fraction * 100);
        return (
          <div key={r} className="grid grid-cols-[44px_1fr_190px] items-center gap-3 text-[13px]">
            <span className="num text-muted">{r}</span>
            <div className="h-3 bg-surface rounded overflow-hidden">
              <div className={`h-full ${b.composition_first ? "bg-amber" : "bg-accent"}`} style={{ width: `${pctv}%` }} />
            </div>
            <span className="num text-muted">
              {r === "16:9" ? "100% native" : `${pctv}% croppable`}
              {b.composition_first && <span className="block text-amber">→ composition-first: {b.chosen_composition}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
