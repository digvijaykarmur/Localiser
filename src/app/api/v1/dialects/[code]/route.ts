import { z } from "zod";
import { DialectCode, DialectPack, packCompleteness } from "@/domain";
import { elevenlabs } from "@/providers";
import { loadPack, packHistory, savePack } from "@/services/dialects";
import { ok, readJson, route } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/dialects/:code — pack, version history, available voices. */
export const GET = route(async (_req, { params }) => {
  const code = DialectCode.parse(params.code);
  const pack = loadPack(code);
  const history = await packHistory(code);
  const el = await elevenlabs();
  const voices = await el.listVoices().catch(() => []);
  return ok({ pack, completeness: packCompleteness(pack), history: history.map((h) => ({ version: h.version, saved_by: h.savedBy, created_at: h.createdAt.toISOString() })), voices });
});

/** PUT /api/v1/dialects/:code — save; writes the JSON file and a dialect_versions row (§6 step 6). */
export const PUT = route(async (req, { params }) => {
  const code = DialectCode.parse(params.code);
  const body = await readJson(req, z.object({ pack: DialectPack, saved_by: z.string().default("channel_lead") }));
  const pack = await savePack(code, body.pack, body.saved_by);
  return ok({ pack, completeness: packCompleteness(pack) });
});
