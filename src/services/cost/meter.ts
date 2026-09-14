import { getRedis } from "@/lib/redis";
import { CostEnvelopeExceeded } from "@/domain/errors";

const KEY = (recipeId: string) => `cost:${recipeId}`;

export const COST_ESTIMATES: Record<string, number> = {
  "vertex.plan": 2,
  "vertex.script": 2,
  "vertex.vision": 0.4,
  "vertex.angle": 1.2,
  "vertex.judge": 0.8,
  "vertex.asr": 0.3,
  "vertex.image": 2,
  "vertex.veo": 80,
  "elevenlabs.tts": 6.2,
  "elevenlabs.music": 8,
};

export class CostMeter {
  async total(recipeId: string): Promise<number> {
    const v = await getRedis().hget(KEY(recipeId), "total");
    return v ? Number(v) : 0;
  }

  async breakdown(recipeId: string): Promise<Record<string, number>> {
    const all = await getRedis().hgetall(KEY(recipeId));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(all)) {
      if (k === "total") continue;
      out[k] = Number(v);
    }
    return out;
  }

  async precheck(recipeId: string, line: string, envelope: number) {
    const estimate = COST_ESTIMATES[line] ?? 0;
    const current = await this.total(recipeId);
    if (current + estimate > envelope) {
      throw new CostEnvelopeExceeded(recipeId, current + estimate, envelope);
    }
  }

  async charge(recipeId: string, line: string, amount: number, envelope: number) {
    const redis = getRedis();
    const total = Number(await redis.hincrbyfloat(KEY(recipeId), "total", amount));
    await redis.hincrbyfloat(KEY(recipeId), line, amount);
    if (total > envelope) {
      throw new CostEnvelopeExceeded(recipeId, total, envelope);
    }
    return total;
  }
}

export const costMeter = new CostMeter();
