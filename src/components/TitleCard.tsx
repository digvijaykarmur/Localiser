import Link from "next/link";
import { DIALECT_NAMES, type DialectCode } from "@/domain/primitives";

export interface TitleListItem {
  id: string;
  name: string;
  name_native: string;
  dialect: DialectCode;
  runtime_ms: number;
  genre: string[];
  intelligence_built_at: string | null;
  scene_count: number | null;
  master_available: boolean;
  evidence: { total: number; usable: number; c916: number };
}

/** States: no-intel · building · ready (§28.4). */
export function TitleCard({ title: t }: { title: TitleListItem }) {
  const ready = !!t.intelligence_built_at;
  const c916 = t.evidence.usable ? t.evidence.c916 / t.evidence.usable : 0;
  return (
    <Link href={`/t/${t.id}`} className="panel p-3 flex flex-col gap-2 hover:border-muted transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="native truncate">{t.name_native}</div>
          <div className="text-muted truncate">{t.name}</div>
        </div>
        <span className={`chip shrink-0 ${ready ? "text-approved border-approved/40" : ""}`}>{ready ? "intel ready" : "no intel"}</span>
      </div>
      <div className="text-[12px] text-muted flex gap-2 flex-wrap">
        <span>{DIALECT_NAMES[t.dialect]}</span>
        <span>· {Math.round(t.runtime_ms / 60000)} min</span>
        {t.scene_count !== null && <span>· {t.scene_count} scenes</span>}
        {!t.master_available && <span className="text-amber">· master not fetched</span>}
      </div>
      {ready && (
        <div className="space-y-1">
          <div className="flex justify-between text-[12px] text-muted">
            <span>{t.evidence.usable} usable units</span>
            <span className="num">{Math.round(c916 * 100)}% vertical-croppable</span>
          </div>
          <div className="h-1 bg-surface rounded overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${c916 * 100}%` }} />
          </div>
        </div>
      )}
    </Link>
  );
}
