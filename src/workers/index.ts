import os from "node:os";
import { Worker } from "bullmq";
import { env } from "@/config/env";
import { assertTwoBrainRule } from "@/config/models";
import { STORAGE_ROOT_ABS } from "@/config/env";
import { pingDb } from "@/db/client";
import { log } from "@/lib/log";
import { binaryStatus } from "@/lib/ffmpeg";
import { FsStorage } from "@/providers/storage";
import { runStage } from "@/services/pipeline";
import { MAINTENANCE_QUEUE, maintenanceQueue, redis, type StageJobData } from "@/services/pipeline/queue";
import { recoverInterruptedJobs } from "./recovery";
import { runNightly } from "./nightly";

const logger = log("workers");

async function main() {
  assertTwoBrainRule();
  const bins = await binaryStatus();
  for (const [name, v] of Object.entries(bins)) {
    if (!v) {
      logger.error(`${name} is not installed`, { install: "sudo apt-get install -y ffmpeg   (macOS: brew install ffmpeg)" });
      process.exit(1);
    }
  }
  const dbOk = await pingDb();
  if (!dbOk.ok) {
    logger.error("Postgres unreachable", { url: env.DATABASE_URL.replace(/:[^:@]*@/, ":***@"), error: dbOk.error, fix: "docker compose up -d postgres && pnpm db:migrate" });
    process.exit(1);
  }
  const connection = redis();
  const cleaned = await new FsStorage(STORAGE_ROOT_ABS).cleanPartials();
  if (cleaned) logger.info("cleaned partial files", { count: cleaned });
  await recoverInterruptedJobs();

  const mediaConcurrency = env.WORKER_MEDIA_CONCURRENCY ?? Math.max(1, os.cpus().length - 1);
  const providerWorker = new Worker<StageJobData>("provider", async (job) => runStage(job.data.jobId, job.data.stage), { connection, concurrency: env.WORKER_PROVIDER_CONCURRENCY });
  const mediaWorker = new Worker<StageJobData>("media", async (job) => runStage(job.data.jobId, job.data.stage), { connection, concurrency: mediaConcurrency });
  const maintenanceWorker = new Worker(MAINTENANCE_QUEUE, async (job) => runNightly(job.name), { connection, concurrency: 1 });

  for (const w of [providerWorker, mediaWorker, maintenanceWorker]) {
    w.on("failed", (job, err) => logger.warn("queue job failed", { queue: w.name, id: job?.id, attempts: job?.attemptsMade, error: err.message }));
    w.on("error", (err) => logger.error("worker error", { queue: w.name, error: err.message }));
  }

  const mq = maintenanceQueue();
  await mq.upsertJobScheduler("nightly-ppp", { pattern: "30 0 * * *" }, { name: "ppp" });
  await mq.upsertJobScheduler("daily-outcomes", { pattern: "0 1 * * *" }, { name: "outcomes" });
  await mq.upsertJobScheduler("daily-canary", { pattern: "0 2 * * *" }, { name: "canary" });

  logger.info("workers up", { provider: env.WORKER_PROVIDER_CONCURRENCY, media: mediaConcurrency, storage: STORAGE_ROOT_ABS, snapshot: env.SNAPSHOT_MODE });

  const shutdown = async () => {
    logger.info("shutting down");
    await Promise.all([providerWorker.close(), mediaWorker.close(), maintenanceWorker.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  logger.error("workers failed to start", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
