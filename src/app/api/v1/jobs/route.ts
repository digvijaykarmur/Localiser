import { z } from "zod";
import { createJob } from "@/services/pipeline";
import { listJobs } from "@/services/pipeline/jobs";
import { ok, readJson, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  return ok({ items: await listJobs(Math.min(200, Math.max(1, limit))) });
});

/** POST /api/v1/jobs {recipe_id} → enqueue PLAN. */
export const POST = route(async (req) => {
  const body = await readJson(req, z.object({ recipe_id: z.string() }));
  const r = await createJob(body.recipe_id);
  return ok({ job_id: r.jobId, promo_id: r.promoId }, undefined, { status: 201 });
});
