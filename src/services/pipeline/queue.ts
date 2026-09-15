import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/config/env";
import type { JobStage } from "@/domain";

export type Lane = "provider" | "media";
export interface StageJobData {
  jobId: string;
  stage: JobStage;
}

declare global {
  // eslint-disable-next-line no-var
  var __promoRedis: IORedis | undefined;
  // eslint-disable-next-line no-var
  var __promoQueues: Record<Lane, Queue<StageJobData>> | undefined;
}

export function redis(): IORedis {
  if (!globalThis.__promoRedis) {
    globalThis.__promoRedis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false, lazyConnect: false });
    globalThis.__promoRedis.on("error", () => {
      /* surfaced via pingRedis */
    });
  }
  return globalThis.__promoRedis;
}

export async function pingRedis(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await redis().ping();
    return { ok: r === "PONG" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Two lanes (§25): provider (rate-limited, retried) and media (CPU-bound). */
export function laneFor(stage: JobStage): Lane {
  return stage === "COMPOSE" ? "media" : "provider";
}

export function queues(): Record<Lane, Queue<StageJobData>> {
  if (!globalThis.__promoQueues) {
    const connection = redis();
    const defaultJobOptions: JobsOptions = { removeOnComplete: 500, removeOnFail: false };
    globalThis.__promoQueues = {
      provider: new Queue<StageJobData>("provider", { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 12, backoff: { type: "exponential", delay: 15_000 } } }),
      media: new Queue<StageJobData>("media", { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 2, backoff: { type: "fixed", delay: 5_000 } } }),
    };
  }
  return globalThis.__promoQueues;
}

let inline = false;
/** Scripts and tests drive stages themselves; in inline mode nothing is enqueued to Redis. */
export function setInlineMode(v: boolean): void {
  inline = v;
}

/** BullMQ job id is deterministic per (job, stage) so duplicate enqueues collapse. BullMQ forbids ":" in custom ids. */
export function stageJobId(jobId: string, stage: JobStage, nonce?: string): string {
  return [jobId, stage, nonce].filter(Boolean).join("__");
}

export async function enqueueStage(jobId: string, stage: JobStage, opts: { delayMs?: number; nonce?: string } = {}): Promise<void> {
  if (inline) return;
  const q = queues()[laneFor(stage)];
  await q.add(stage, { jobId, stage }, { jobId: stageJobId(jobId, stage, opts.nonce), delay: opts.delayMs });
}

export const MAINTENANCE_QUEUE = "maintenance";
export function maintenanceQueue(): Queue {
  return new Queue(MAINTENANCE_QUEUE, { connection: redis(), defaultJobOptions: { removeOnComplete: 50, removeOnFail: 50 } });
}
