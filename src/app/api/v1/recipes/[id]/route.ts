import { z } from "zod";
import { jsonOk, jsonError } from "@/lib/http";
import { Recipe } from "@/domain";
import { db } from "@/db/client";
import { recipes } from "@/db/schema";
import { eq } from "drizzle-orm";

const Envelope = z.object({ recipe: Recipe });

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const row = (await db.select().from(recipes).where(eq(recipes.id, ctx.params.id)))[0];
    if (!row) return jsonError("not found", 404);
    return jsonOk(Envelope, { recipe: Recipe.parse(row.payload) });
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
