import { z } from "zod";
import { DialectCode } from "./primitives";

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
  intelligence_built_at: z.string().datetime().nullable(),
});
export type Title = z.infer<typeof Title>;

/** Default spoiler boundary: nothing after 60% of runtime appears in a promo. */
export function defaultSpoilerBoundaryMs(runtimeMs: number): number {
  return Math.floor(runtimeMs * 0.6);
}

/** A scene boundary as delivered by the catalogue / ClickHouse before intelligence. */
export const RawScene = z.object({
  title_id: z.string(),
  seq: z.number().int().nonnegative(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().positive(),
});
export type RawScene = z.infer<typeof RawScene>;

export const Page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable() });
export type Page<T> = { items: T[]; next_cursor: string | null };
