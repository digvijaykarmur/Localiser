import { Queue, Worker, type Job } from "bullmq";
import { getRedis } from "@/lib/redis";
import { env, providers } from "@/lib/env";
import { runPipeline } from "@/services/pipeline";
import { cleanPartials } from "@/services/composer";
import { storage } from "@/providers/storage";
import { getVertex } from "@/providers/vertex";
import { getModel, MODEL_PURPOSES } from "@/lib/models";
import { db } from "@/db/client";
import { providerCanary } from "@/db/schema";
import type { PipelineStage } from "@/domain";

function connection() {
  return getRedis();
}

export const providerQueue = new Queue("provider", { connection: connection() });
export const mediaQueue = new Queue("media", { connection: connection() });

export async function enqueuePipeline(jobId: string, fromStage: PipelineStage = "PLAN") {
  await mediaQueue.add(
    "pipeline",
    { jobId, fromStage },
    { jobId: `pipe-${jobId}-${fromStage}`, removeOnComplete: 100, removeOnFail: 100 },
  );
}

export function startWorkers() {
  cleanPartials(storage.abs(""));
  const worker = new Worker(
    "media",
    async (job: Job) => {
      if (job.name === "pipeline") {
        await runPipeline(job.data.jobId, job.data.fromStage);
      }
      if (job.name === "canary") {
        await runCanary();
      }
    },
    { connection: connection(), concurrency: 1 },
  );
  worker.on("failed", (job, err) => {
    console.error("worker failed", job?.id, err);
  });
  void runCanary().catch((e) => console.error("canary", e));
  return worker;
}

export async function runCanary() {
  const vertex = getVertex();
  const purposes = providers.vertex
    ? (["judge"] as const)
    : MODEL_PURPOSES;
  for (const purpose of purposes) {
    const model = getModel(purpose);
    try {
      await vertex.canary(model.id);
      await db
        .insert(providerCanary)
        .values({
          provider: `vertex.${purpose}`,
          model: model.id,
          lastOkAt: new Date(),
          lastError: providers.vertex ? null : "snapshot-mode",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: providerCanary.provider,
          set: {
            lastOkAt: new Date(),
            lastError: providers.vertex ? null : "snapshot-mode",
            model: model.id,
            updatedAt: new Date(),
          },
        });
    } catch (e) {
      await db
        .insert(providerCanary)
        .values({
          provider: `vertex.${purpose}`,
          model: model.id,
          lastOkAt: null,
          lastError: (e as Error).message,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: providerCanary.provider,
          set: { lastError: (e as Error).message, updatedAt: new Date() },
        });
    }
  }
  const extras: Array<{ name: string; live: boolean }> = [
    { name: "elevenlabs", live: providers.elevenlabs },
    { name: "antryami", live: providers.antryami },
    { name: "clickhouse", live: providers.clickhouse },
  ];
  for (const p of extras) {
    await db
      .insert(providerCanary)
      .values({
        provider: p.name,
        model: null,
        lastOkAt: new Date(),
        lastError: p.live ? null : "snapshot-mode",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: providerCanary.provider,
        set: {
          lastOkAt: new Date(),
          lastError: p.live ? null : "snapshot-mode",
          updatedAt: new Date(),
        },
      });
  }
}

async function main() {
  startWorkers();
  console.log("workers up");
}

const isWorkerScript = (process.argv[1] ?? "").includes("workers");
if (isWorkerScript) {
  void main();
}
