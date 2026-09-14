import { jsonOk, jsonError, readJson } from "@/lib/http";
import { RetryRequest } from "@/domain";
import { z } from "zod";
import { env } from "@/lib/env";
import { runPipeline } from "@/services/pipeline";
import { enqueuePipeline } from "@/workers/index";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

const Envelope = z.object({ job_id: z.string(), from_stage: z.string() });

export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const body = await readJson(req, RetryRequest);
    const row = (await db.select().from(jobs).where(eq(jobs.id, ctx.params.id)))[0];
    if (!row) return jsonError("not found", 404);
    await db
      .update(jobs)
      .set({ status: "queued", error: null, updatedAt: new Date() })
      .where(eq(jobs.id, ctx.params.id));
    if (env.SNAPSHOT_MODE) void runPipeline(ctx.params.id, body.from_stage).catch(console.error);
    else await enqueuePipeline(ctx.params.id, body.from_stage);
    return jsonOk(Envelope, { job_id: ctx.params.id, from_stage: body.from_stage });
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }
}
