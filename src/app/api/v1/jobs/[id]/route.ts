import { getJobView } from "@/services/pipeline/jobs";
import { ok, route } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/jobs/:id — stage, progress, cost, artifacts. Polled by the Job screen. */
export const GET = route(async (_req, { params }) => ok(await getJobView(params.id!)));
