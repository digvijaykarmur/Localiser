import { z } from "zod";
import { jsonOk, jsonError } from "@/lib/http";
import { DialectPack } from "@/domain";
import { allDialectPacks } from "@/lib/registry";

const Envelope = z.object({ dialects: z.array(DialectPack) });

export async function GET() {
  try {
    return jsonOk(Envelope, { dialects: allDialectPacks() });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
