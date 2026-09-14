import { z } from "zod";
import { jsonOk, jsonError, readJson } from "@/lib/http";
import { ReviewRequest } from "@/domain";
import { applyReview } from "@/services/ledger";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

const Envelope = z.object({ ok: z.literal(true) });

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const body = await readJson(req, ReviewRequest);
    const row = (await db.select().from(jobs).where(eq(jobs.id, ctx.params.id)))[0];
    if (!row) return jsonError("not found", 404);
    await applyReview({
      recipeId: row.recipeId,
      verdict: body.verdict,
      reason_codes: body.reason_codes,
      edit_minutes: body.edit_minutes,
    });
    return jsonOk(Envelope, { ok: true });
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }
}
