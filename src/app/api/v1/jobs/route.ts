import { z } from "zod";
import { jsonOk, jsonError, readJson } from "@/lib/http";
import { enqueueJob } from "@/services/pipeline";
import { kickoffPipeline } from "@/services/kickoff";

const Body = z.object({ recipe_id: z.string() });
const Created = z.object({ job_id: z.string() });

export async function POST(req: Request) {
  try {
    const body = await readJson(req, Body);
    const jobId = await enqueueJob(body.recipe_id);
    await kickoffPipeline(jobId, "PLAN");
    return jsonOk(Created, { job_id: jobId }, 201);
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }
}
