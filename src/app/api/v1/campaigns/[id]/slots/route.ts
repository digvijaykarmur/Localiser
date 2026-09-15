import { SlotCreateRequest, SlotFillRequest } from "@/domain";
import { addSlots, campaignView, fillSlots, previewFill } from "@/services/tracker/campaigns";
import { ok, route } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => ok(await campaignView(params.id!)));

/**
 * POST /api/v1/campaigns/:id/slots
 *   {slots:[{date,intended_format}]}          → add empty slots
 *   {fills:[...], preset_id}[?preview=1]      → batch fill (preview shows the combined cost first, §10)
 */
export const POST = route(async (req, { params }) => {
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if ("fills" in raw) {
    const body = SlotFillRequest.parse(raw);
    if (new URL(req.url).searchParams.get("preview") === "1") return ok(await previewFill(params.id!, body));
    return ok(await fillSlots(params.id!, body), undefined, { status: 201 });
  }
  const body = SlotCreateRequest.parse(raw);
  return ok(await addSlots(params.id!, body), undefined, { status: 201 });
});
