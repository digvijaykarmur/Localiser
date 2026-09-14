import { z } from "zod";
import { DialectCode } from "./codes";

export const Title = z.object({
  id: z.string(),
  name: z.string(),
  name_native: z.string(),
  dialect: DialectCode,
  synopsis: z.string(),
  runtime_ms: z.number().int().positive(),
  spoiler_boundary_ms: z.number().int().positive(),
  genre: z.array(z.string()),
  artwork_url: z.string().url().nullable(),
  deep_link: z.string(),
});
export type Title = z.infer<typeof Title>;
