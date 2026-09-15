import { packCompleteness } from "@/domain";
import { allPacks } from "@/services/dialects";
import { getTiersForDialect } from "@/services/metrics/ppp";
import { ok, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/dialects — six packs with completeness and PPP tiers. */
export const GET = route(async () => {
  const packs = allPacks();
  const items = [];
  for (const p of packs) items.push({ pack: p, completeness: packCompleteness(p), tiers: await getTiersForDialect(p.code) });
  return ok({ items });
});
