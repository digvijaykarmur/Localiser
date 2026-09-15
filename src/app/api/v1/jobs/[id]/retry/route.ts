import { z } from "zod";
import { RetryFromStage } from "@/domain";
import { retryJob } from "@/services/pipeline";
import { getJobView } from "@/services/pipeline/jobs";
import { ok, readJson, route } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/jobs/:id/retry {from_stage} (or ?from=STAGE). Retry from COMPOSE costs ₹0. */
export const POST = route(async (req, { params }) => {
  const q = new URL(req.url).searchParams.get("from");
  const body = q ? { from_stage: q } : await readJson(req, z.object({ from_stage: z.string() }));
  const from = RetryFromStage.parse(body.from_stage);
  await retryJob(params.id!, from);
  return ok(await getJobView(params.id!));
});
