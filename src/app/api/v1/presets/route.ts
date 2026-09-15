import { z } from "zod";
import { Preset, PresetRequest } from "@/domain";
import { createPreset, listPresets } from "@/services/recipes";
import { ok, readJson, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => ok({ items: await listPresets() }, z.object({ items: z.array(Preset) })));

export const POST = route(async (req) => {
  const body = await readJson(req, PresetRequest);
  return ok(await createPreset(body), Preset, { status: 201 });
});
