import { CampaignRequest } from "@/domain";
import { createCampaign, listCampaigns } from "@/services/tracker/campaigns";
import { ok, readJson, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ items: await listCampaigns() }));

export const POST = route(async (req) => {
  const body = await readJson(req, CampaignRequest);
  return ok(await createCampaign(body), undefined, { status: 201 });
});
