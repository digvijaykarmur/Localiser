import { z } from "zod";
import { jsonOk, jsonError } from "@/lib/http";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

const Envelope = z.object({ job_id: z.string(), status: z.literal("cancelled") });

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  try {
    const row = (await db.select().from(jobs).where(eq(jobs.id, ctx.params.id)))[0];
    if (!row) return jsonError("not found", 404);
    await db
      .update(jobs)
      .set({
        status: "cancelled",
        cancelRequested: true,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, ctx.params.id));
    return jsonOk(Envelope, { job_id: ctx.params.id, status: "cancelled" });
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }
}
