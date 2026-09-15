import { models } from "@/config/models";
import { providerModes } from "@/config/env";
import { log } from "@/lib/log";
import { elevenlabs, vertex } from "@/providers";

const logger = log("canary");

export interface CanaryResult {
  provider: string;
  model: string;
  ok: boolean;
  latency_ms: number;
  error?: string;
  skipped?: string;
}

/** Daily provider canary (acceptance test 18): one trivial call per model id; alert on deprecation. */
export async function runCanary(): Promise<CanaryResult[]> {
  const modes = providerModes();
  const out: CanaryResult[] = [];
  const textModels = [...new Set([models.evidence_vision.model, models.angles.model, models.plan.model, models.script.model, models.judge.model, models.asr.model])];

  if (modes.vertex === "snapshot") {
    for (const m of textModels) out.push({ provider: "vertex", model: m, ok: true, latency_ms: 0, skipped: "snapshot mode" });
  } else {
    const v = await vertex();
    for (const m of textModels) {
      const r = await v.canary(m);
      out.push({ provider: "vertex", model: m, ok: r.ok, latency_ms: r.latency_ms, error: r.error });
      if (!r.ok) logger.error("canary failed", { model: m, error: r.error });
    }
  }

  const el = await elevenlabs();
  const t0 = Date.now();
  const p = await el.ping();
  out.push({ provider: "elevenlabs", model: models.music.model, ok: p.ok, latency_ms: Date.now() - t0, error: p.error, skipped: modes.elevenlabs === "snapshot" ? "snapshot mode" : undefined });

  logger.info("canary complete", { failures: out.filter((r) => !r.ok).length });
  return out;
}
