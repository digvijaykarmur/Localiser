import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type JSONSchema = Record<string, unknown>;

/** Gemini's responseSchema is an OpenAPI subset; strip what it rejects. */
export function toResponseSchema(schema: z.ZodTypeAny): JSONSchema {
  const js = zodToJsonSchema(schema, { $refStrategy: "none", target: "openApi3" }) as Record<string, unknown>;
  return strip(js) as JSONSchema;
}

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      if (k === "$schema" || k === "additionalProperties" || k === "default" || k === "pattern" || k === "$ref" || k === "definitions") continue;
      out[k] = strip(val);
    }
    return out;
  }
  return v;
}

export function safeJsonParse(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}
