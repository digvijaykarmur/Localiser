import { ReviewRequest } from "@/domain";
import { reviewPromo, reviewQueue } from "@/services/tracker/review";
import { ok, readJson, route } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

/** GET — the review queue with this promo's position (so Enter can advance). */
export const GET = route(async (_req, { params }) => {
  const queue = await reviewQueue();
  return ok({ queue, index: queue.findIndex((q) => q.promo_id === params.id) });
});

/** POST /api/v1/promos/:id/review — verdict, reason codes, edit minutes (J3). */
export const POST = route(async (req, { params }) => {
  const body = await readJson(req, ReviewRequest);
  return ok(await reviewPromo(params.id!, body));
});
