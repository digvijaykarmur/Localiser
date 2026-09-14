import { z } from "zod";
import { jsonOk, jsonError } from "@/lib/http";
import { TitleIntelligence } from "@/domain";
import { buildIntelligence, getIntelligence } from "@/services/intelligence";

const Envelope = z.object({ intelligence: TitleIntelligence });

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const intel = await getIntelligence(ctx.params.id);
    if (!intel) return jsonError("not found", 404);
    return jsonOk(Envelope, { intelligence: intel });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  try {
    const intelligence = await buildIntelligence(ctx.params.id);
    return jsonOk(Envelope, { intelligence });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
