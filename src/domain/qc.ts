import { z } from "zod";

export const DeterministicCheckId = z.enum([
  "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D14", "D15", "D16", "D17",
]);
export type DeterministicCheckId = z.infer<typeof DeterministicCheckId>;

export const D_CHECK_LABELS: Record<DeterministicCheckId, string> = {
  D1: "duration vs target ±300ms",
  D2: "resolution and fps exact",
  D3: "audio present on all declared tracks",
  D4: "integrated loudness −14 LUFS ±1.0",
  D5: "true peak ≤ −1.0 dBTP",
  D6: "longest silence ≤ 1200ms",
  D7: "longest black-frame run ≤ 400ms",
  D8: "text/CTA boxes inside safe area",
  D9: "layer dest boxes inside canvas",
  D10: "every beat has ≥1 resolvable evidence_id",
  D11: "no evidence after spoiler_boundary_ms",
  D12: "word budget respected",
  D13: "cost within envelope",
  D14: "intensity monotonic STAKE→ESCALATE",
  D15: "tracked-crop velocity ≤ 8%/s",
  D16: "treatment matrix respected",
  D17: "provenance complete on every asset",
};

export const CheckResult = z.object({
  id: z.string(),
  pass: z.boolean(),
  detail: z.string(),
  measured: z.union([z.number(), z.string(), z.boolean(), z.null()]).optional(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const DeterministicReport = z.object({
  ratio: z.string(),
  checks: z.array(CheckResult),
  all_pass: z.boolean(),
});
export type DeterministicReport = z.infer<typeof DeterministicReport>;

/** Judge model output (§18.5). */
export const JudgeGate = z.object({ pass: z.boolean(), evidence: z.string().max(400) });
export const JudgeScore = z.object({ score: z.number().int().min(1).max(10), reasoning: z.string().max(300) });

export const JudgeVerdict = z.object({
  A1_subject_integrity: JudgeGate.extend({ offending_frames: z.array(z.number().int()).max(30) }),
  A2_claim_truth: JudgeGate.extend({ unsupported_lines: z.array(z.string()).max(10) }),
  A3_spoiler: JudgeGate,
  A4_text_legibility: JudgeGate,
  A6_hook_strength: JudgeScore,
  A7_pacing: JudgeScore,
  A8_overall_craft: JudgeScore,
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

export const AiReport = z.object({
  ratio: z.string(),
  judge: JudgeVerdict,
  A5_dialect_similarity: z.number().min(0).max(1).nullable(),
  transcript: z.string(),
  gates_pass: z.boolean(),
  warnings: z.array(z.string()),
  model: z.string(),
  prompt_version: z.string(),
  cost_inr: z.number(),
});
export type AiReport = z.infer<typeof AiReport>;

export const QCReport = z.object({
  ratio: z.string(),
  deterministic: DeterministicReport,
  ai: AiReport.nullable(),
  gate_pass: z.boolean(),
});
export type QCReport = z.infer<typeof QCReport>;

/** Flatten a judge verdict into the ledger's qc_ai record. */
export function flattenJudge(ai: AiReport | null): Record<string, number | boolean> {
  if (!ai) return {};
  const j = ai.judge;
  const out: Record<string, number | boolean> = {
    A1: j.A1_subject_integrity.pass,
    A2: j.A2_claim_truth.pass,
    A3: j.A3_spoiler.pass,
    A4: j.A4_text_legibility.pass,
    A6: j.A6_hook_strength.score,
    A7: j.A7_pacing.score,
    A8: j.A8_overall_craft.score,
  };
  if (ai.A5_dialect_similarity !== null) out.A5 = ai.A5_dialect_similarity;
  return out;
}

/** Normalised Levenshtein similarity for ASR vs intended script (§20.3, A5). */
export function textSimilarity(a: string, b: string): number {
  const na = normalise(a);
  const nb = normalise(b);
  if (na.length === 0 && nb.length === 0) return 1;
  const d = levenshtein(na, nb);
  return 1 - d / Math.max(na.length, nb.length);
}

function normalise(s: string): string {
  return s.replace(/[।॥,.!?;:"'()\-–—…\s]+/g, " ").trim().toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}
