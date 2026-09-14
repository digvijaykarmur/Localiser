import { z } from "zod";
import { jsonOk, jsonError, readJson } from "@/lib/http";
import { CreateRecipeRequest, Recipe } from "@/domain";
import { getFormat } from "@/lib/registry";
import { db } from "@/db/client";
import { recipes } from "@/db/schema";
import { id, nowIso } from "@/lib/hash";

const Created = z.object({ recipe: Recipe });

export async function POST(req: Request) {
  try {
    const body = await readJson(req, CreateRecipeRequest);
    const format = getFormat(body.format);
    if (body.format === "SC" && !body.source_window) {
      return jsonError("SC requires source_window", 400);
    }
    if (body.format === "SU" && !body.persona_id) {
      return jsonError("SU requires persona_id", 400);
    }
    const recipe = Recipe.parse({
      id: id("rcp"),
      version: 1 as const,
      created_at: nowIso(),
      created_by: body.created_by,
      title_id: body.title_id,
      angle_id: body.angle_id,
      format: body.format,
      dialect: body.dialect,
      duration_s: body.duration_s,
      ratios: body.ratios,
      source_window: body.source_window ?? null,
      persona_id: body.persona_id ?? null,
      music_brief: body.music_brief ?? null,
      cta_variant: body.cta_variant,
      cost_envelope_inr: format.cost_envelope_inr,
      planner_prompt_version: body.format === "CP" ? "plan.cp.v1" : `plan.${body.format.toLowerCase()}.v1`,
      seed: body.seed ?? 7,
    });
    await db.insert(recipes).values({
      id: recipe.id,
      payload: recipe,
      createdAt: new Date(recipe.created_at),
    });
    return jsonOk(Created, { recipe }, 201);
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }
}
