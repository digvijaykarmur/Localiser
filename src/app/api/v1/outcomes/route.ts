import { OutcomeBatch } from "@/domain";
import { ingestOutcomes, syncOutcomes } from "@/services/tracker/outcomes";
import { ok, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/outcomes — bulk performance sync.
 * Body {rows:[...]} applies the rows; an empty body pulls analytics.promo_performance via ClickHouse.
 */
export const POST = route(async (req) => {
  const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (Array.isArray(raw.rows) && raw.rows.length) return ok(await ingestOutcomes(OutcomeBatch.parse(raw).rows));
  return ok(await syncOutcomes(30));
});
