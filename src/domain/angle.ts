import { z } from "zod";
import type { EvidenceUnit } from "./evidence";

export const AngleKind = z.enum([
  "character",
  "relationship",
  "conflict",
  "mystery",
  "comedy",
  "world",
  "performance",
  "dialogue",
]);
export type AngleKind = z.infer<typeof AngleKind>;

/** What the model produces. `vertical_feasible` is computed afterwards. */
export const AngleProposal = z.object({
  kind: AngleKind,
  claim: z.string().max(180),
  evidence_ids: z.array(z.string()).min(2).max(8),
  hook_candidate_ids: z.array(z.string()).min(1).max(3),
  audience_note: z.string().max(200),
  spoiler_safe: z.boolean(),
});
export type AngleProposal = z.infer<typeof AngleProposal>;

export const AngleProposalSet = z.object({ angles: z.array(AngleProposal).length(6) });

export const Angle = AngleProposal.extend({
  id: z.string(),
  title_id: z.string(),
  vertical_feasible: z.boolean(), // computed
});
export type Angle = z.infer<typeof Angle>;

/**
 * An angle is vertically feasible when at least 60% of its cited evidence is croppable at 9:16
 * OR when it cites at least two dialogue-bearing single-subject units that compose well in a
 * caption-dominant layout (§17.3 composition-first preference).
 */
export function computeVerticalFeasible(proposal: AngleProposal, evidence: Map<string, EvidenceUnit>): boolean {
  const cited = proposal.evidence_ids.map((id) => evidence.get(id)).filter((e): e is EvidenceUnit => !!e);
  if (cited.length === 0) return false;
  const croppable = cited.filter((e) => e.croppable_916).length / cited.length;
  if (croppable >= 0.6) return true;
  const composable = cited.filter((e) => e.usable && e.has_dialogue && e.subject_count <= 1).length;
  return composable >= 2;
}

/** Referential EGC check: every id an angle cites must exist for the title. */
export function findUnknownEvidenceIds(ids: string[], known: Set<string>): string[] {
  return ids.filter((id) => !known.has(id));
}
