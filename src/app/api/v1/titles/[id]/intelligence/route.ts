import { buildIntelligence, estimateIntelligence } from "@/services/intelligence/build";
import { getAngles, getEvidence, getTitle } from "@/services/titles";
import { ok, route } from "../../../../_lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/v1/titles/:id/intelligence — evidence + angles. */
export const GET = route(async (_req, { params }) => {
  const title = await getTitle(params.id!);
  const [evidence, angles] = await Promise.all([getEvidence(title.id), getAngles(title.id)]);
  return ok({ title, evidence, angles });
});

/**
 * POST /api/v1/titles/:id/intelligence[?estimate=1][&force=1]
 * With estimate=1 nothing is spent: returns scenes, cost and minutes for the button label (§5 step 5).
 */
export const POST = route(async (req, { params }) => {
  const q = new URL(req.url).searchParams;
  if (q.get("estimate") === "1") return ok(await estimateIntelligence(params.id!));
  const r = await buildIntelligence(params.id!, { force: q.get("force") === "1" });
  const angles = await getAngles(params.id!);
  return ok({ evidence: r.evidence, angles, cost_inr: r.cost_inr });
});
