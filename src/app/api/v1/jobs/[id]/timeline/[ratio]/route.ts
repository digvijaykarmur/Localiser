import { PromoError, Ratio, Timeline } from "@/domain";
import { latestArtifact } from "@/services/pipeline";
import { ok, route } from "../../../../../_lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/jobs/:id/timeline/:ratio — the Timeline JSON, inspectable (ratio as 9x16 or 9:16). */
export const GET = route(async (_req, { params }) => {
  const ratio = Ratio.parse(params.ratio!.replace("x", ":"));
  const a = await latestArtifact(params.id!, "timeline", ratio);
  if (!a) throw new PromoError("NOT_FOUND", `No timeline for ${ratio} on job ${params.id}. COMPOSE has not run yet.`);
  return ok(Timeline.parse(a.payload), Timeline);
});
