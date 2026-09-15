import { desc, eq, and } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { computeTier, editMinutesForVerdict, median, SPOILER_CODES, type DialectCode, type FormatCode, type PPPTier, type Verdict } from "@/domain";
import { log } from "@/lib/log";

const logger = log("ppp");

export interface PairStats {
  format: FormatCode;
  dialect: DialectCode;
  promos: number;
  reviewed: number;
  approved: number;
  approval_rate: number;
  median_edit_minutes: number | null;
  recent_r01_r02: number;
  tier: PPPTier;
}

/**
 * One ledger row exists per (promo, ratio). PPP counts promos, not ratios, so rows are
 * collapsed to one entry per promo_id before any statistic is computed.
 */
function collapseByPromo(rows: (typeof schema.ledger.$inferSelect)[]) {
  const byPromo = new Map<string, typeof schema.ledger.$inferSelect>();
  for (const r of rows) if (!byPromo.has(r.promoId)) byPromo.set(r.promoId, r);
  return [...byPromo.values()];
}

export function statsFromRows(format: FormatCode, dialect: DialectCode, rowsIn: (typeof schema.ledger.$inferSelect)[]): PairStats {
  const rows = collapseByPromo(rowsIn);
  const reviewed = rows.filter((r) => r.editorVerdict);
  const approved = reviewed.filter((r) => r.editorVerdict === "approved");
  const edits = reviewed.map((r) => editMinutesForVerdict(r.editorVerdict as Verdict, r.editorEditMinutes)).filter((v): v is number => v !== null);
  const recent = [...reviewed].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 30);
  const recentR01R02 = recent.filter((r) => r.editorReasonCodes.some((c) => (SPOILER_CODES as string[]).includes(c))).length;
  const approvalRate = reviewed.length ? approved.length / reviewed.length : 0;
  const input = { promos: rows.length, approval_rate: approvalRate, median_edit_minutes: median(edits), recent_r01_r02: recentR01R02 };
  return { format, dialect, promos: rows.length, reviewed: reviewed.length, approved: approved.length, approval_rate: approvalRate, median_edit_minutes: input.median_edit_minutes, recent_r01_r02: recentR01R02, tier: computeTier(input) };
}

export async function computePairTier(format: FormatCode, dialect: DialectCode): Promise<PairStats> {
  const rows = await db.query.ledger.findMany({ where: and(eq(schema.ledger.format, format), eq(schema.ledger.dialect, dialect)), orderBy: desc(schema.ledger.createdAt) });
  return statsFromRows(format, dialect, rows);
}

/** Nightly (§33): recompute every (format, dialect) pair that has at least one ledger row. */
export async function computeAllTiers(): Promise<PairStats[]> {
  const rows = await db.query.ledger.findMany({ orderBy: desc(schema.ledger.createdAt) });
  const groups = new Map<string, (typeof schema.ledger.$inferSelect)[]>();
  for (const r of rows) {
    const k = `${r.format}|${r.dialect}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: PairStats[] = [];
  for (const [k, g] of groups) {
    const [format, dialect] = k.split("|") as [FormatCode, DialectCode];
    const s = statsFromRows(format, dialect, g);
    out.push(s);
    await db
      .insert(schema.pppTiers)
      .values({ format, dialect, tier: s.tier, promos: s.promos, approvalRate: s.approval_rate, medianEditMinutes: s.median_edit_minutes, recentR01R02: s.recent_r01_r02, computedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.pppTiers.format, schema.pppTiers.dialect],
        set: { tier: s.tier, promos: s.promos, approvalRate: s.approval_rate, medianEditMinutes: s.median_edit_minutes, recentR01R02: s.recent_r01_r02, computedAt: new Date() },
      });
  }
  logger.info("ppp tiers recomputed", { pairs: out.length });
  return out;
}

/** Stored tier for a pair; PROVE when nothing has been computed yet. */
export async function getTier(format: FormatCode, dialect: DialectCode): Promise<PPPTier> {
  const r = await db.query.pppTiers.findFirst({ where: and(eq(schema.pppTiers.format, format), eq(schema.pppTiers.dialect, dialect)) });
  return (r?.tier as PPPTier | undefined) ?? "PROVE";
}

export async function getTiersForDialect(dialect: DialectCode): Promise<Record<FormatCode, PPPTier>> {
  const rows = await db.query.pppTiers.findMany({ where: eq(schema.pppTiers.dialect, dialect) });
  const out: Record<FormatCode, PPPTier> = { SC: "PROVE", CP: "PROVE", SU: "PROVE" };
  for (const r of rows) out[r.format as FormatCode] = r.tier as PPPTier;
  return out;
}
