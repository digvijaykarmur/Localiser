import { z } from "zod";
import { jsonOk, jsonError, readJson } from "@/lib/http";
import { enqueueJob, runPipeline } from "@/services/pipeline";
import { enqueuePipeline } from "@/workers/index";
import { env } from "@/lib/env";

const Body = z.object({ recipe_id: z.string() });
const Created = z.object({ job_id: z.string() });

export async function POST(req: Request) {
  try {
    const body = await readJson(req, Body);
    const jobId = await enqueueJob(body.recipe_id);
    if (env.SNAPSHOT_MODE) {
      void runPipeline(jobId, "PLAN").catch((e) => console.error(e));
    } else {
      await enqueuePipeline(jobId, "PLAN");
    }
    return jsonOk(Created, { job_id: jobId }, 201);
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }
}
