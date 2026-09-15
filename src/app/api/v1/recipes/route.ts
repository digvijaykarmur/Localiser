import { Recipe, RecipeRequest } from "@/domain";
import { createRecipe, previewRecipe } from "@/services/recipes";
import { ok, readJson, route } from "../../_lib/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/recipes[?preview=1]
 * preview=1 returns the Frame Budget and cost estimate at zero cost (§7.1 ③); otherwise locks an immutable recipe.
 */
export const POST = route(async (req) => {
  const body = await readJson(req, RecipeRequest);
  if (new URL(req.url).searchParams.get("preview") === "1") return ok(await previewRecipe(body));
  const r = await createRecipe(body);
  return ok({ recipe: Recipe.parse(r.recipe), preview: r.preview }, undefined, { status: 201 });
});
