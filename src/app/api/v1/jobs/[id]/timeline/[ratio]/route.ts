import { z } from "zod";
import { jsonOk, jsonError } from "@/lib/http";
import { Timeline } from "@/domain";
import { db } from "@/db/client";
import { jobs, timelines } from "@/db/schema";
import { eq } from "drizzle-orm";

const Envelope = z.object({ timeline: Timeline });

function parseRatio(raw: string) {
  const decoded = decodeURIComponent(raw);
  return decoded.replace("x", ":");
}

export async function GET(_req: Request, ctx: { params: { id: string; ratio: string } }) {
  try {
    const job = (await db.select().from(jobs).where(eq(jobs.id, ctx.params.id)))[0];
    if (!job) return jsonError("job not found", 404);
    const ratio = parseRatio(ctx.params.ratio);
    const row = (await db.select().from(timelines)).find(
      (t) => t.recipeId === job.recipeId && t.ratio === ratio,
    );
    if (!row) return jsonError("timeline not found", 404);
    return jsonOk(Envelope, { timeline: Timeline.parse(row.payload) });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
