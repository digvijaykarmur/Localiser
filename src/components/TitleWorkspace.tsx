"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Angle, EvidenceUnit, FormatPolicy, Preset, Title } from "@/domain";
import { DIALECT_NAMES, FORMAT_NAMES, type FormatCode, type PPPTier } from "@/domain/primitives";
import { AngleCard } from "./AngleCard";
import { ErrorBox } from "./ErrorBox";
import { EvidenceGrid } from "./EvidenceGrid";
import { RecipeBuilder } from "./RecipeBuilder";
import { api, inr, type ApiError } from "./lib/api";

type Tab = "evidence" | "angles" | "compose";

export function TitleWorkspace(props: {
  title: Title;
  evidence: EvidenceUnit[];
  angles: Angle[];
  presets: Preset[];
  tiers: Record<FormatCode, PPPTier>;
  formats: FormatPolicy[];
  estimate: { scenes: number; cost_inr: number; minutes: number } | null;
  ctaVariants: string[];
  initialTab: Tab;
  initialAngle: string | null;
}) {
  const { title } = props;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const [angleId, setAngleId] = useState<string | null>(props.initialAngle ?? props.angles.find((a) => a.spoiler_safe && a.vertical_feasible)?.id ?? props.angles[0]?.id ?? null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const built = !!title.intelligence_built_at;

  const build = async (force = false) => {
    setBuilding(true);
    setError(null);
    try {
      await api(`/api/v1/titles/${title.id}/intelligence${force ? "?force=1" : ""}`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError((e as { error?: ApiError }).error ?? { code: "ERROR", message: String(e) });
    } finally {
      setBuilding(false);
    }
  };

  const usable = props.evidence.filter((e) => e.usable);
  const c916 = usable.length ? usable.filter((e) => e.croppable_916).length / usable.length : 0;
  const c11 = usable.length ? usable.filter((e) => e.croppable_11).length / usable.length : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="native-lg font-bold">{title.name_native}</h1>
          <div className="text-muted">
            {title.name} · {DIALECT_NAMES[title.dialect]} · {Math.round(title.runtime_ms / 60000)} min · spoiler boundary {Math.round(title.spoiler_boundary_ms / 60000)} min
            {title.genre.length ? ` · ${title.genre.join(", ")}` : ""}
          </div>
        </div>
        {built && (
          <div className="flex items-center gap-3 text-[12px] text-muted">
            <span>
              <span className="text-ink num">{usable.length}</span> usable
            </span>
            <span>
              1:1 <span className="text-ink num">{Math.round(c11 * 100)}%</span>
            </span>
            <span>
              9:16 <span className="text-ink num">{Math.round(c916 * 100)}%</span>
            </span>
            <button className="btn btn-sm" onClick={() => build(true)} disabled={building} title="Re-run vision and angles">
              {building ? "Rebuilding…" : `Rebuild${props.estimate ? ` ${inr(props.estimate.cost_inr)}` : ""}`}
            </button>
          </div>
        )}
      </div>

      <div className="flex border-b border-hairline">
        {(["evidence", "angles", "compose"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {t === "evidence" ? `Evidence${built ? ` · ${props.evidence.length}` : ""}` : t === "angles" ? `Angles${built ? ` · ${props.angles.length}` : ""}` : "Compose"}
          </button>
        ))}
      </div>

      <ErrorBox error={error} />

      {!built ? (
        <div className="panel p-10 text-center space-y-3">
          <div className="text-ink">Intelligence not built.</div>
          <div className="text-muted">
            {props.estimate ? `Building takes ~${props.estimate.minutes} min across ${props.estimate.scenes} scenes and costs ~${inr(props.estimate.cost_inr)}.` : "Building describes every scene with the vision model and computes croppability."}
          </div>
          <button className="btn btn-primary" onClick={() => build(false)} disabled={building}>
            {building ? "Building…" : `Build intelligence ${props.estimate ? inr(props.estimate.cost_inr) : ""}`}
          </button>
        </div>
      ) : tab === "evidence" ? (
        <EvidenceGrid evidence={props.evidence} spoilerBoundaryMs={title.spoiler_boundary_ms} />
      ) : tab === "angles" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {props.angles.map((a) => (
            <AngleCard
              key={a.id}
              angle={a}
              evidence={props.evidence}
              selected={a.id === angleId}
              onSelect={() => {
                setAngleId(a.id);
                setTab("compose");
              }}
            />
          ))}
        </div>
      ) : (
        <RecipeBuilder title={title} angles={props.angles} angleId={angleId} onAngle={setAngleId} presets={props.presets} tiers={props.tiers} formats={props.formats} ctaVariants={props.ctaVariants} />
      )}
      <div className="text-[12px] text-faint">
        Formats: {props.formats.map((f) => `${FORMAT_NAMES[f.code]} (${props.tiers[f.code]})`).join(" · ")}
      </div>
    </div>
  );
}
