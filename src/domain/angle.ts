import { z } from "zod";

export const Angle = z.object({
  id: z.string(),
  title_id: z.string(),
  kind: z.enum([
    "character",
    "relationship",
    "conflict",
    "mystery",
    "comedy",
    "world",
    "performance",
    "dialogue",
  ]),
  claim: z.string().max(180),
  evidence_ids: z.array(z.string()).min(2),
  hook_candidate_ids: z.array(z.string()).min(1),
  audience_note: z.string().max(200),
  spoiler_safe: z.boolean(),
  vertical_feasible: z.boolean(),
});
export type Angle = z.infer<typeof Angle>;
