import { z } from "zod";
import { jsonOk, jsonError } from "@/lib/http";
import { db } from "@/db/client";
import { artifacts, jobs, ledger } from "@/db/schema";
import { eq } from "drizzle-orm";
import { costMeter } from "@/services/cost/meter";
import { LedgerRow, PromoJob } from "@/domain";

const Envelope = z.object({
  job: PromoJob,
  cost_inr: z.number(),
  cost_breakdown: z.record(z.string(), z.number()),
  artifacts: z.array(
    z.object({
      stage: z.string(),
      ratio: z.string(),
      storage_key: z.string(),
    }),
  ),
  ledger: z.array(LedgerRow),
});

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const row = (await db.select().from(jobs).where(eq(jobs.id, ctx.params.id)))[0];
    if (!row) return jsonError("not found", 404);
    const job = PromoJob.parse({
      id: row.id,
      recipe_id: row.recipeId,
      status: row.status,
      stage: row.stage,
      progress: row.progress,
      cost_inr: row.costInr,
      error: row.error,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    });
    const arts = (await db.select().from(artifacts)).filter((a) => a.recipeId === row.recipeId);
    const led = (await db.select().from(ledger).where(eq(ledger.recipeId, row.recipeId))).map((r) =>
      LedgerRow.parse(r.payload),
    );
    return jsonOk(Envelope, {
      job,
      cost_inr: await costMeter.total(row.recipeId),
      cost_breakdown: await costMeter.breakdown(row.recipeId),
      artifacts: arts.map((a) => ({ stage: a.stage, ratio: a.ratio, storage_key: a.storageKey })),
      ledger: led,
    });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
