import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { CostEnvelopeExceeded, PromoError } from "@/domain";
import { round2 } from "@/config/models";

/**
 * Cost meter (§26). Checked before each expensive call (estimate) and after (actual).
 * Exceeding the recipe's envelope throws — a hard stop, not a warning.
 */
export class CostMeter {
  constructor(
    private readonly jobId: string,
    private readonly recipeId: string,
    private readonly envelopeInr: number,
  ) {}

  async spent(): Promise<{ total: number; breakdown: Record<string, number> }> {
    const job = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, this.jobId) });
    if (!job) throw new PromoError("NOT_FOUND", `job ${this.jobId} not found`);
    return { total: Number(job.costSpentInr), breakdown: job.costBreakdown ?? {} };
  }

  /** Pre-check: would this estimated amount exceed the envelope? */
  async reserve(item: string, estimateInr: number): Promise<void> {
    const { total } = await this.spent();
    if (total + estimateInr > this.envelopeInr) throw new CostEnvelopeExceeded(this.recipeId, total, this.envelopeInr, item, estimateInr);
  }

  /** Post-charge: record the actual amount. Throws if the envelope is now exceeded. */
  async charge(item: string, amountInr: number): Promise<number> {
    const amount = round2(amountInr);
    if (amount === 0) return (await this.spent()).total;
    const { total, breakdown } = await this.spent();
    const next = round2(total + amount);
    breakdown[item] = round2((breakdown[item] ?? 0) + amount);
    await db
      .update(schema.jobs)
      .set({ costSpentInr: sql`${next}`, costBreakdown: breakdown })
      .where(eq(schema.jobs.id, this.jobId));
    if (next > this.envelopeInr) throw new CostEnvelopeExceeded(this.recipeId, total, this.envelopeInr, item, amount);
    return next;
  }
}

/** Static pre-generation estimate shown on the Generate button (§7.1). Snapshot mode is free. */
export function estimateRecipeCostInr(args: {
  format: "SC" | "CP" | "SU";
  duration_s: number;
  ratios: number;
  snapshot: { vertex: boolean; elevenlabs: boolean };
  inrPerUsd: number;
}): { total: number; breakdown: Record<string, number> } {
  const b: Record<string, number> = {};
  const usd = (n: number) => round2(n * args.inrPerUsd);
  if (!args.snapshot.vertex) {
    b["vertex.plan"] = usd(0.02 * args.ratios);
    if (args.format !== "SC") b["vertex.script"] = usd(0.02);
    b["vertex.judge"] = usd(0.01 * args.ratios);
    b["vertex.asr"] = usd(0.005 * args.ratios);
    if (args.format === "SU") b["vertex.veo"] = usd(0.15 * Math.min(8, args.duration_s - 5) * args.ratios);
  }
  if (!args.snapshot.elevenlabs && args.format !== "SC") {
    b["elevenlabs.tts"] = usd(0.18 * 0.4);
    b["elevenlabs.music"] = usd(0.5);
  }
  b["media.render"] = 0;
  const total = round2(Object.values(b).reduce((s, v) => s + v, 0));
  return { total, breakdown: b };
}

/** Intelligence build estimate (§5 step 5): one vision call per scene + one angles call. */
export function estimateIntelligenceCostInr(sceneCount: number, snapshot: boolean, inrPerUsd: number): number {
  if (snapshot) return 0;
  return round2((sceneCount * 0.006 + 0.05) * inrPerUsd);
}
