import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { Angle, EvidenceUnit, PromoError, Title, type DialectCode } from "@/domain";

export function rowToTitle(r: typeof schema.titles.$inferSelect): Title {
  return Title.parse({
    id: r.id,
    name: r.name,
    name_native: r.nameNative,
    dialect: r.dialect,
    synopsis: r.synopsis,
    runtime_ms: r.runtimeMs,
    spoiler_boundary_ms: r.spoilerBoundaryMs,
    genre: r.genre,
    artwork_url: r.artworkUrl,
    deep_link: r.deepLink,
    intelligence_built_at: r.intelligenceBuiltAt ? r.intelligenceBuiltAt.toISOString() : null,
  });
}

export function rowToEvidence(r: typeof schema.evidenceUnits.$inferSelect): EvidenceUnit {
  return EvidenceUnit.parse({
    id: r.id,
    title_id: r.titleId,
    start_ms: r.startMs,
    end_ms: r.endMs,
    frame_urls: r.frameUrls,
    description: r.description,
    shot_type: r.shotType,
    subject_count: r.subjectCount,
    subject_boxes: r.subjectBoxes,
    motion: r.motion,
    emotion: r.emotion,
    intensity: r.intensity,
    has_dialogue: r.hasDialogue,
    dialogue_native: r.dialogueNative,
    is_spoiler: r.isSpoiler,
    usable: r.usable,
    unusable_reason: r.unusableReason,
    croppable_11: r.croppable11,
    croppable_916: r.croppable916,
    crop_note: r.cropNote,
  });
}

export function rowToAngle(r: typeof schema.angles.$inferSelect): Angle {
  return Angle.parse({
    id: r.id,
    title_id: r.titleId,
    kind: r.kind,
    claim: r.claim,
    evidence_ids: r.evidenceIds,
    hook_candidate_ids: r.hookCandidateIds,
    audience_note: r.audienceNote,
    spoiler_safe: r.spoilerSafe,
    vertical_feasible: r.verticalFeasible,
  });
}

export async function listTitles(dialect?: DialectCode) {
  const rows = await db.query.titles.findMany({ where: dialect ? eq(schema.titles.dialect, dialect) : undefined, orderBy: asc(schema.titles.name) });
  const counts = await db.select({ titleId: schema.evidenceUnits.titleId, id: schema.evidenceUnits.id, usable: schema.evidenceUnits.usable, c916: schema.evidenceUnits.croppable916 }).from(schema.evidenceUnits);
  const byTitle = new Map<string, { total: number; usable: number; c916: number }>();
  for (const c of counts) {
    const cur = byTitle.get(c.titleId) ?? { total: 0, usable: 0, c916: 0 };
    cur.total++;
    if (c.usable) cur.usable++;
    if (c.c916) cur.c916++;
    byTitle.set(c.titleId, cur);
  }
  return rows.map((r) => ({ ...rowToTitle(r), scene_count: r.sceneCount, master_available: !!r.masterStorageKey, evidence: byTitle.get(r.id) ?? { total: 0, usable: 0, c916: 0 } }));
}

export async function getTitle(id: string): Promise<Title> {
  const r = await db.query.titles.findFirst({ where: eq(schema.titles.id, id) });
  if (!r) throw new PromoError("NOT_FOUND", `Title ${id} not found. Sync titles from the Library first.`);
  return rowToTitle(r);
}

export async function getTitleRow(id: string) {
  const r = await db.query.titles.findFirst({ where: eq(schema.titles.id, id) });
  if (!r) throw new PromoError("NOT_FOUND", `Title ${id} not found. Sync titles from the Library first.`);
  return r;
}

export async function getEvidence(titleId: string): Promise<EvidenceUnit[]> {
  const rows = await db.query.evidenceUnits.findMany({ where: eq(schema.evidenceUnits.titleId, titleId), orderBy: asc(schema.evidenceUnits.startMs) });
  return rows.map(rowToEvidence);
}

export async function getAngles(titleId: string): Promise<Angle[]> {
  const rows = await db.query.angles.findMany({ where: eq(schema.angles.titleId, titleId), orderBy: asc(schema.angles.id) });
  return rows.map(rowToAngle);
}

export async function getAngle(angleId: string): Promise<Angle> {
  const r = await db.query.angles.findFirst({ where: eq(schema.angles.id, angleId) });
  if (!r) throw new PromoError("NOT_FOUND", `Angle ${angleId} not found. Build intelligence for the title first.`);
  return rowToAngle(r);
}
