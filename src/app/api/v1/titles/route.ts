import { z } from "zod";
import { DialectCode } from "@/domain";
import { syncTitles } from "@/services/intelligence/ingest";
import { listTitles } from "@/services/titles";
import { ok, readJson, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/titles?dialect=hry — list, filter by dialect. */
export const GET = route(async (req) => {
  const dialect = new URL(req.url).searchParams.get("dialect");
  const parsed = dialect ? DialectCode.parse(dialect) : undefined;
  return ok({ items: await listTitles(parsed) });
});

/** POST /api/v1/titles — sync titles from the catalogue (J0 step 4). */
export const POST = route(async (req) => {
  const body = await readJson(req, z.object({ dialect: DialectCode.optional() }).default({}));
  const r = await syncTitles(body.dialect);
  return ok({ synced: r.synced, items: await listTitles(body.dialect) });
});
