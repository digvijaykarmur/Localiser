import { z } from "zod";
import { deliverPromo, deliveryView, markPublished } from "@/services/tracker/delivery";
import { ok, route } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

/** GET — delivery gate status, export URLs and manifest. */
export const GET = route(async (_req, { params }) => ok(await deliveryView(params.id!)));

/**
 * POST /api/v1/promos/:id/deliver — write the export bundle (3 mp4 + manifest.json).
 * Body {published: true, published_at?} records the manual publish (§12 step 5).
 */
export const POST = route(async (req, { params }) => {
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body = z.object({ published: z.boolean().default(false), published_at: z.string().datetime().optional() }).parse(raw);
  if (body.published) return ok(await markPublished(params.id!, body.published_at ? new Date(body.published_at) : new Date()));
  return ok(await deliverPromo(params.id!));
});
