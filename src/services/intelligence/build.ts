import { eq } from "drizzle-orm";
import { env, providerModes } from "@/config/env";
import { models } from "@/config/models";
import { db, schema } from "@/db/client";
import {
  AngleProposalSet,
  EvidenceDescription,
  computeVerticalFeasible,
  evidenceId,
  findUnknownEvidenceIds,
  withCroppability,
  type EvidenceUnit,
} from "@/domain";
import { ids } from "@/lib/ids";
import { log } from "@/lib/log";
import { storage } from "@/providers";
import { ANGLES_GENERATE_V2, EVIDENCE_DESCRIBE_V1, withInput } from "@/prompts";
import { callModel } from "../cost/modelClient";
import { estimateIntelligenceCostInr } from "../cost/meter";
import { getEvidence, getTitle } from "../titles";
import { extractFrames, fetchScenes } from "./ingest";

const logger = log("intelligence");

export async function estimateIntelligence(titleId: string): Promise<{ scenes: number; cost_inr: number; minutes: number; cached: boolean }> {
  const title = await getTitle(titleId);
  const scenes = await fetchScenes(titleId);
  const snapshot = providerModes().vertex === "snapshot";
  return {
    scenes: scenes.length,
    cost_inr: estimateIntelligenceCostInr(scenes.length, snapshot, env.INR_PER_USD),
    minutes: snapshot ? 1 : Math.max(1, Math.round((scenes.length * 4) / 60) + 1),
    cached: title.intelligence_built_at !== null,
  };
}

export type IntelProgress = { phase: "frames" | "evidence" | "angles" | "done"; done: number; total: number };

/**
 * S2 — build intelligence for a title (cached per title; §17.2).
 * Pass A: vision description per scene. Pass B: computeCroppable (code). Pass C: six angles.
 */
export async function buildIntelligence(titleId: string, opts: { force?: boolean; onProgress?: (p: IntelProgress) => void } = {}): Promise<{ evidence: EvidenceUnit[]; angles: number; cost_inr: number }> {
  const title = await getTitle(titleId);
  if (title.intelligence_built_at && !opts.force) {
    const ev = await getEvidence(titleId);
    const angles = await db.query.angles.findMany({ where: eq(schema.angles.titleId, titleId) });
    return { evidence: ev, angles: angles.length, cost_inr: 0 };
  }

  const scenes = await fetchScenes(titleId);
  const frames = await extractFrames(titleId, scenes, (d, t) => opts.onProgress?.({ phase: "frames", done: d, total: t }));
  const st = storage();
  let cost = 0;

  // Pass A + B
  const units: EvidenceUnit[] = [];
  let done = 0;
  for (const s of scenes) {
    const frameKeys = frames.get(s.seq) ?? [];
    const images = await Promise.all(frameKeys.map((k) => st.get(k)));
    const input = { title_id: titleId, seq: s.seq, start_ms: s.start_ms, end_ms: s.end_ms, title_name: title.name, dialect: title.dialect };
    const r = await callModel({
      schema: EvidenceDescription,
      model: models.evidence_vision.model,
      temperature: models.evidence_vision.temperature ?? 0.1,
      system: EVIDENCE_DESCRIBE_V1.system,
      user: [...images.map((image) => ({ image, mimeType: "image/jpeg" })), { text: withInput(`Scene ${s.seq}, ${fmt(s.start_ms)}–${fmt(s.end_ms)}. Three frames in order.`, input) }],
      meta: { stage: "evidence_vision", prompt_version: EVIDENCE_DESCRIBE_V1.version, title_id: titleId },
    });
    cost += r.cost_inr;
    const d = r.value;
    const unit = withCroppability({
      id: evidenceId(titleId, s.seq),
      title_id: titleId,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      frame_urls: await Promise.all(frameKeys.map((k) => st.url(k))),
      ...d,
      subject_boxes: d.subject_boxes.slice(0, 6),
      subject_count: d.subject_count,
    });
    units.push(unit);
    done++;
    opts.onProgress?.({ phase: "evidence", done, total: scenes.length });
  }

  // Persist evidence (stable ids → upsert)
  await db.transaction(async (tx) => {
    for (const u of units) {
      await tx
        .insert(schema.evidenceUnits)
        .values({
          id: u.id,
          titleId: u.title_id,
          startMs: u.start_ms,
          endMs: u.end_ms,
          frameUrls: u.frame_urls,
          description: u.description,
          shotType: u.shot_type,
          subjectCount: u.subject_count,
          subjectBoxes: u.subject_boxes,
          motion: u.motion,
          emotion: u.emotion,
          intensity: u.intensity,
          hasDialogue: u.has_dialogue,
          dialogueNative: u.dialogue_native,
          isSpoiler: u.is_spoiler,
          usable: u.usable,
          unusableReason: u.unusable_reason,
          croppable11: u.croppable_11,
          croppable916: u.croppable_916,
          cropNote: u.crop_note,
        })
        .onConflictDoUpdate({
          target: schema.evidenceUnits.id,
          set: {
            description: u.description,
            shotType: u.shot_type,
            subjectCount: u.subject_count,
            subjectBoxes: u.subject_boxes,
            motion: u.motion,
            emotion: u.emotion,
            intensity: u.intensity,
            hasDialogue: u.has_dialogue,
            dialogueNative: u.dialogue_native,
            isSpoiler: u.is_spoiler,
            usable: u.usable,
            unusableReason: u.unusable_reason,
            croppable11: u.croppable_11,
            croppable916: u.croppable_916,
            cropNote: u.crop_note,
            frameUrls: u.frame_urls,
          },
        });
    }
  });

  // Pass C — angles over usable, pre-boundary evidence
  opts.onProgress?.({ phase: "angles", done: 0, total: 1 });
  const usable = units.filter((u) => u.usable && u.start_ms < title.spoiler_boundary_ms);
  const known = new Set(usable.map((u) => u.id));
  const evidenceMap = new Map(units.map((u) => [u.id, u]));
  const anglesInput = {
    title_id: titleId,
    synopsis: title.synopsis,
    spoiler_boundary_ms: title.spoiler_boundary_ms,
    evidence: usable.map((u) => ({ id: u.id, start_ms: u.start_ms, end_ms: u.end_ms, description: u.description, shot_type: u.shot_type, intensity: u.intensity, has_dialogue: u.has_dialogue, dialogue_native: u.dialogue_native, is_spoiler: u.is_spoiler })),
  };
  const ar = await callModel({
    schema: AngleProposalSet,
    model: models.angles.model,
    temperature: models.angles.temperature ?? 0.8,
    system: ANGLES_GENERATE_V2.system,
    user: [{ text: withInput("Propose six angles.", anglesInput) }],
    meta: { stage: "angles", prompt_version: ANGLES_GENERATE_V2.version, title_id: titleId },
    verify: (v) => {
      const issues: string[] = [];
      v.angles.forEach((a, i) => {
        const unknown = findUnknownEvidenceIds([...a.evidence_ids, ...a.hook_candidate_ids], known);
        if (unknown.length) issues.push(`angle ${i}: unknown or unusable evidence ids ${unknown.join(",")}`);
        if (a.hook_candidate_ids.some((h) => !a.evidence_ids.includes(h))) issues.push(`angle ${i}: hook candidates must be among evidence_ids`);
      });
      return issues;
    },
  });
  cost += ar.cost_inr;

  await db.transaction(async (tx) => {
    await tx.delete(schema.angles).where(eq(schema.angles.titleId, titleId));
    for (const [i, a] of ar.value.angles.entries()) {
      const spoilerSafe = a.spoiler_safe && !a.evidence_ids.some((id) => evidenceMap.get(id)?.is_spoiler);
      await tx.insert(schema.angles).values({
        id: ids.angle(titleId, i),
        titleId,
        kind: a.kind,
        claim: a.claim,
        evidenceIds: a.evidence_ids,
        hookCandidateIds: a.hook_candidate_ids,
        audienceNote: a.audience_note,
        spoilerSafe,
        verticalFeasible: computeVerticalFeasible(a, evidenceMap),
        promptVersion: ANGLES_GENERATE_V2.version,
      });
    }
    await tx.update(schema.titles).set({ intelligenceBuiltAt: new Date() }).where(eq(schema.titles.id, titleId));
  });

  opts.onProgress?.({ phase: "done", done: 1, total: 1 });
  logger.info("intelligence built", { titleId, units: units.length, cost });
  return { evidence: units, angles: 6, cost_inr: cost };
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
