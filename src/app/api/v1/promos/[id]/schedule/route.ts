import { ScheduleRequest } from "@/domain";
import { schedulePromo } from "@/services/tracker/delivery";
import { ok, readJson, route } from "../../../../_lib/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/promos/:id/schedule {channel, scheduled_at} — gated on approval + QC + provenance. */
export const POST = route(async (req, { params }) => {
  const body = await readJson(req, ScheduleRequest);
  return ok(await schedulePromo(params.id!, body));
});
