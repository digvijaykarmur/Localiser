import { desc, eq } from "drizzle-orm";
import { env, providerModes } from "@/config/env";
import { db, schema } from "@/db/client";
import {
  DURATIONS,
  frameBudget,
  minEvidenceForDuration,
  Preset,
  PromoError,
  Recipe,
  type Angle,
  type EvidenceUnit,
  type FormatCode,
  type Ratio,
  type RecipeRequest,
  type Title,
} from "@/domain";
import { ids } from "@/lib/ids";
import { PROMPT_VERSIONS } from "@/prompts";
import { estimateRecipeCostInr } from "./cost/meter";
import { ensurePackVersionRecorded, loadPack } from "./dialects";
import { loadFormat } from "./formats";
import { getAngle, getEvidence, getTitle } from "./titles";

export function rowToRecipe(r: typeof schema.recipes.$inferSelect): Recipe {
  return Recipe.parse({
    id: r.id,
    schema_version: r.schemaVersion,
    created_at: r.createdAt.toISOString(),
    created_by: r.createdBy,
    title_id: r.titleId,
    angle_id: r.angleId,
    format: r.format,
    dialect: r.dialect,
    duration_s: r.durationS,
    ratios: r.ratios,
    source_window: r.sourceWindow ?? null,
    persona_id: r.personaId,
    music_brief: r.musicBrief,
    cta_variant: r.ctaVariant,
    cost_envelope_inr: r.costEnvelopeInr,
    dialect_pack_version: r.dialectPackVersion,
    prompt_versions: r.promptVersions,
    seed: r.seed,
  });
}

/** Evidence a recipe may draw on: usable, pre-boundary, non-spoiler, inside the source window. */
export function eligibleEvidence(all: EvidenceUnit[], title: Title, window: { start_ms: number; end_ms: number } | null): EvidenceUnit[] {
  return all.filter(
    (e) =>
      e.usable &&
      !e.is_spoiler &&
      e.start_ms < title.spoiler_boundary_ms &&
      (!window || (e.end_ms > window.start_ms && e.start_ms < window.end_ms)),
  );
}

export interface RecipePreview {
  frame_budget: Record<Ratio, ReturnType<typeof frameBudget>>;
  estimate: { total: number; breakdown: Record<string, number> };
  eligible_evidence: number;
  min_evidence: number;
  envelope_inr: number;
  ok: boolean;
  problems: string[];
}

/** Zero-cost preview shown on the Compose tab before Generate (§7.1). */
export async function previewRecipe(req: RecipeRequest): Promise<RecipePreview> {
  const title = await getTitle(req.title_id);
  const angle = await getAngle(req.angle_id);
  const policy = loadFormat(req.format);
  const all = await getEvidence(req.title_id);
  const eligible = eligibleEvidence(all, title, req.source_window);
  const angleEvidence = eligible.filter((e) => angle.evidence_ids.includes(e.id));
  const pool = angleEvidence.length >= 2 ? angleEvidence : eligible;
  const minEv = minEvidenceForDuration(req.duration_s, policy);
  const problems: string[] = [];
  if (angle.title_id !== title.id) problems.push(`Angle ${angle.id} does not belong to title ${title.id}.`);
  if (!title.intelligence_built_at) problems.push("Intelligence not built for this title.");
  if (eligible.length < minEv) problems.push(`This title has ${eligible.length} usable scenes. A ${req.duration_s}s ${policy.name} needs at least ${minEv}. Pick another title or a shorter duration.`);
  if (!angle.spoiler_safe) problems.push("This angle cites spoiler evidence; choose another angle.");
  if (policy.spine === "light") {
    // A Single Clip is HOOK + ≤2 continuous moments; each beat is capped by its unit length.
    const pack = loadPack(req.dialect);
    const lens = eligible.map((e) => e.end_ms - e.start_ms).sort((a, b) => b - a);
    const maxBody = Math.min(pack.rhythm.hook_max_ms, lens[0] ?? 0) + (lens[1] ?? 0) + (lens[2] ?? 0);
    const needBody = req.duration_s * 1000 - policy.cta_duration_s * 1000;
    if (maxBody < needBody) {
      const feasible = DURATIONS.filter((d) => d * 1000 - policy.cta_duration_s * 1000 <= maxBody);
      problems.push(`A ${req.duration_s}s ${policy.name} needs ${(needBody / 1000).toFixed(0)}s of continuous footage; the longest usable scenes here give ${(maxBody / 1000).toFixed(1)}s. ${feasible.length ? `Choose ${feasible.join("s or ")}s.` : "Choose Caption Promo, which cuts between scenes."}`);
    }
  }
  const modes = providerModes();
  const estimate = estimateRecipeCostInr({ format: req.format, duration_s: req.duration_s, ratios: req.ratios.length, snapshot: { vertex: modes.vertex === "snapshot", elevenlabs: modes.elevenlabs === "snapshot" }, inrPerUsd: env.INR_PER_USD });
  const fb = {} as Record<Ratio, ReturnType<typeof frameBudget>>;
  for (const r of ["16:9", "9:16", "1:1"] as Ratio[]) fb[r] = frameBudget(pool, r, policy.composition_default);
  const envelope = req.cost_envelope_inr ?? policy.default_envelope_inr;
  if (estimate.total > envelope) problems.push(`Estimated cost ₹${estimate.total} exceeds the envelope ₹${envelope}.`);
  return { frame_budget: fb, estimate, eligible_evidence: eligible.length, min_evidence: minEv, envelope_inr: envelope, ok: problems.length === 0, problems };
}

/** S3 — lock an immutable recipe. No model calls. */
export async function createRecipe(req: RecipeRequest): Promise<{ recipe: Recipe; preview: RecipePreview }> {
  const preview = await previewRecipe(req);
  if (!preview.ok) throw new PromoError("INSUFFICIENT_EVIDENCE", preview.problems.join(" "), { detail: { problems: preview.problems }, recovery: "Adjust the recipe and try again. Nothing was charged." });
  const policy = loadFormat(req.format);
  const pack = await ensurePackVersionRecorded(req.dialect);
  const promptVersions: Record<string, string> = {};
  for (const k of Object.keys(policy.prompt_versions)) promptVersions[k] = PROMPT_VERSIONS[k as keyof typeof PROMPT_VERSIONS] ?? policy.prompt_versions[k]!;
  promptVersions.evidence = PROMPT_VERSIONS.evidence;
  promptVersions.angles = PROMPT_VERSIONS.angles;
  promptVersions.judge = PROMPT_VERSIONS.judge;

  const recipe: Recipe = Recipe.parse({
    id: ids.recipe(),
    schema_version: 1,
    created_at: new Date().toISOString(),
    created_by: req.created_by,
    title_id: req.title_id,
    angle_id: req.angle_id,
    format: req.format,
    dialect: req.dialect,
    duration_s: req.duration_s,
    ratios: req.ratios,
    source_window: req.source_window,
    persona_id: req.persona_id,
    music_brief: req.music_brief,
    cta_variant: req.cta_variant,
    cost_envelope_inr: preview.envelope_inr,
    dialect_pack_version: pack.version,
    prompt_versions: promptVersions,
    seed: req.seed ?? Math.floor(Math.random() * 2 ** 31),
  });
  await db.insert(schema.recipes).values({
    id: recipe.id,
    schemaVersion: 1,
    createdAt: new Date(recipe.created_at),
    createdBy: recipe.created_by,
    titleId: recipe.title_id,
    angleId: recipe.angle_id,
    format: recipe.format,
    dialect: recipe.dialect,
    durationS: recipe.duration_s,
    ratios: recipe.ratios,
    sourceWindow: recipe.source_window,
    personaId: recipe.persona_id,
    musicBrief: recipe.music_brief,
    ctaVariant: recipe.cta_variant,
    costEnvelopeInr: recipe.cost_envelope_inr,
    dialectPackVersion: recipe.dialect_pack_version,
    promptVersions: recipe.prompt_versions,
    seed: recipe.seed,
  });
  return { recipe, preview };
}

export async function getRecipe(id: string): Promise<Recipe> {
  const r = await db.query.recipes.findFirst({ where: eq(schema.recipes.id, id) });
  if (!r) throw new PromoError("NOT_FOUND", `Recipe ${id} not found`);
  return rowToRecipe(r);
}

export async function listPresets(): Promise<Preset[]> {
  const rows = await db.query.presets.findMany({ orderBy: desc(schema.presets.createdAt) });
  return rows.map((r) =>
    Preset.parse({ id: r.id, name: r.name, format: r.format, dialect: r.dialect, duration_s: r.durationS, ratios: r.ratios, cta_variant: r.ctaVariant, music_brief: r.musicBrief, created_at: r.createdAt.toISOString() }),
  );
}

export async function createPreset(p: Omit<Preset, "id" | "created_at">): Promise<Preset> {
  const id = ids.preset();
  const createdAt = new Date();
  await db.insert(schema.presets).values({ id, name: p.name, format: p.format, dialect: p.dialect, durationS: p.duration_s, ratios: p.ratios, ctaVariant: p.cta_variant, musicBrief: p.music_brief, createdAt });
  return { id, created_at: createdAt.toISOString(), ...p };
}

export async function getPreset(id: string): Promise<Preset> {
  const r = await db.query.presets.findFirst({ where: eq(schema.presets.id, id) });
  if (!r) throw new PromoError("NOT_FOUND", `Preset ${id} not found`);
  return Preset.parse({ id: r.id, name: r.name, format: r.format, dialect: r.dialect, duration_s: r.durationS, ratios: r.ratios, cta_variant: r.ctaVariant, music_brief: r.musicBrief, created_at: r.createdAt.toISOString() });
}

export { loadFormat };
export type { Angle, FormatCode };
