import { cancelJob } from "@/services/pipeline";
import { getJobView } from "@/services/pipeline/jobs";
import { ok, route } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

export const POST = route(async (_req, { params }) => {
  await cancelJob(params.id!);
  return ok(await getJobView(params.id!));
});
