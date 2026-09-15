import { Recipe } from "@/domain";
import { getRecipe } from "@/services/recipes";
import { ok, route } from "../../../_lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => ok(await getRecipe(params.id!), Recipe));
