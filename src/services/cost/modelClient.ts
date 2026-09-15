import type { z } from "zod";
import { db } from "@/db/client";
import { modelCalls } from "@/db/schema";
import { ModelContractFailure } from "@/domain";
import { hashInputs } from "@/lib/hash";
import { ids } from "@/lib/ids";
import { toResponseSchema } from "@/lib/json";
import { log } from "@/lib/log";
import { keys, storage, vertex, type Content, type ModelCallMeta } from "@/providers";
import type { CostMeter } from "./meter";

const logger = log("model");

export interface CallArgs<S extends z.ZodTypeAny> {
  schema: S;
  model: string;
  temperature: number;
  system: string;
  user: Content[];
  meta: ModelCallMeta & { job_id?: string };
  seed?: number;
  meter?: CostMeter;
  costItem?: string;
  /** Extra validation after Zod parse (e.g. referential EGC). Return issues; empty = ok. */
  verify?: (value: z.infer<S>) => string[];
}

/**
 * The one door to a language model (§18.6). Schema-validated JSON only. On parse failure, retry
 * at most twice with the Zod error appended. Third failure → MODEL_CONTRACT_FAILURE with raw
 * output persisted. Every attempt is logged to model_calls.
 */
export async function callModel<S extends z.ZodTypeAny>(args: CallArgs<S>): Promise<{ value: z.infer<S>; cost_inr: number; model: string }> {
  const v = await vertex();
  const responseSchema = toResponseSchema(args.schema);
  const inputHash = hashInputs(args.model, args.system, args.user.map((c) => ("text" in c ? c.text : `<binary:${("image" in c ? c.image : c.audio).length}>`)));
  let user = args.user;
  let lastError = "";
  let totalCost = 0;
  let rawKey: string | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (args.meter && args.costItem) await args.meter.reserve(args.costItem, 0.5);
    let rawText = "";
    let cost = 0;
    let tokens = { in: 0, out: 0 };
    let latency = 0;
    let parsed: z.SafeParseReturnType<unknown, z.infer<S>> | null = null;
    let issues: string[] = [];
    try {
      const r = await v.generate<unknown>({ model: args.model, system: args.system, user, schema: responseSchema, temperature: args.temperature, seed: args.seed, meta: args.meta });
      rawText = r.raw_text;
      cost = r.cost_inr;
      tokens = r.tokens;
      latency = r.latency_ms;
      parsed = args.schema.safeParse(r.value);
      if (parsed.success && args.verify) issues = args.verify(parsed.data);
    } catch (e) {
      if (e instanceof SyntaxError) {
        lastError = `invalid JSON: ${e.message}`;
      } else throw e;
    }
    totalCost += cost;
    if (args.meter && args.costItem && cost > 0) await args.meter.charge(args.costItem, cost);

    const ok = !!parsed?.success && issues.length === 0;
    await db.insert(modelCalls).values({
      callId: ids.call(),
      stage: args.meta.stage,
      recipeId: args.meta.recipe_id ?? null,
      titleId: args.meta.title_id ?? null,
      model: args.model,
      promptVersion: args.meta.prompt_version,
      inputHash,
      tokensIn: tokens.in,
      tokensOut: tokens.out,
      costInr: cost,
      latencyMs: latency,
      attempt,
      schemaOk: ok,
    });

    if (ok && parsed?.success) return { value: parsed.data, cost_inr: totalCost, model: args.model };

    if (parsed && !parsed.success) lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    else if (issues.length) lastError = issues.join("; ");
    logger.warn("model contract violation", { stage: args.meta.stage, attempt, error: lastError.slice(0, 400) });

    if (rawText && args.meta.job_id) {
      rawKey = keys.raw(args.meta.job_id, args.meta.stage, attempt);
      await storage().put(rawKey, Buffer.from(rawText, "utf8"), "text/plain");
    }
    user = [...args.user, { text: `\n\nYour previous output failed validation:\n${lastError}\nReturn corrected JSON that satisfies the schema exactly.` }];
  }
  throw new ModelContractFailure(args.meta.stage, args.meta.prompt_version, rawKey, lastError);
}
