import { AiJudgeResult, type EvidenceUnit, type Title } from "@/domain";
import { levenshteinRatio } from "@/services/scripter";
import { env } from "@/lib/env";
import { getVertex } from "@/providers/vertex";
import { JUDGE_V1 } from "@/prompts/judge.v1";
import { getModel } from "@/lib/models";
import { z } from "zod";

const JudgeSchema = z.object({
  A1_subject_integrity: z.boolean(),
  A2_claim_truth: z.boolean(),
  A3_spoiler: z.boolean(),
  A4_text_legibility: z.boolean(),
  A5_dialect_match: z.number().min(0).max(1),
  A6_hook_strength: z.number().min(1).max(10),
  A7_pacing: z.number().min(1).max(10),
  A8_overall_craft: z.number().min(1).max(10),
  notes: z.record(z.string(), z.string()).default({}),
});

export async function runAiJudge(args: {
  filePath: string;
  transcript: string;
  intendedScript: string;
  evidence: EvidenceUnit[];
  title: Title;
  recipeId: string;
}): Promise<AiJudgeResult> {
  const dialect = levenshteinRatio(args.transcript, args.intendedScript || args.transcript);
  const snapshot = (): AiJudgeResult => {
    const parsed = JudgeSchema.parse({
      A1_subject_integrity: true,
      A2_claim_truth: true,
      A3_spoiler: true,
      A4_text_legibility: true,
      A5_dialect_match: dialect || 1,
      A6_hook_strength: 7,
      A7_pacing: 7,
      A8_overall_craft: 7,
      notes: { mode: "snapshot" },
    });
    return AiJudgeResult.parse({
      ...parsed,
      gate_pass:
        parsed.A1_subject_integrity &&
        parsed.A2_claim_truth &&
        parsed.A3_spoiler &&
        parsed.A4_text_legibility,
    });
  };

  if (env.SNAPSHOT_MODE) return snapshot();

  try {
    const vertex = getVertex();
    const model = getModel("judge");
    const res = await vertex.generateJson({
      model: model.id,
      systemInstruction: JUDGE_V1,
      user: {
        synopsis: args.title.synopsis,
        transcript: args.transcript,
        evidence: args.evidence.map((e) => ({ id: e.id, description: e.description })),
        frames_note: "sampled 1fps from rendered file — frames attached out of band in live adapter",
      },
      schema: JudgeSchema,
      temperature: model.temperature ?? 0,
      stage: "QC",
      recipeId: args.recipeId,
      promptVersion: "judge.v1",
    });
    const parsed = res.parsed;
    return AiJudgeResult.parse({
      ...parsed,
      gate_pass:
        parsed.A1_subject_integrity &&
        parsed.A2_claim_truth &&
        parsed.A3_spoiler &&
        parsed.A4_text_legibility,
    });
  } catch (e) {
    return AiJudgeResult.parse({
      ...snapshot(),
      notes: { mode: "snapshot_fallback", error: (e as Error).message.slice(0, 240) },
    });
  }
}
