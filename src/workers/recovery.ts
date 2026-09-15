import { inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { log } from "@/lib/log";
import { enqueueStage } from "@/services/pipeline/queue";
import type { JobStage } from "@/domain";

const logger = log("recovery");

/**
 * Worker crash mid-stage (§25): jobs left in a running stage are re-enqueued at that stage.
 * Artifacts are idempotent, so completed work is reused; a half-written render was a .partial
 * and has been cleaned.
 */
export async function recoverInterruptedJobs(): Promise<number> {
  const running = await db.query.jobs.findMany({ where: inArray(schema.jobs.stage, ["PLAN", "SCRIPT", "ASSEMBLE", "COMPOSE", "QC", "WAITING_PROVIDER"]) });
  let n = 0;
  for (const j of running) {
    const stage = (j.stage === "WAITING_PROVIDER" ? j.resumeStage : j.stage) as JobStage | null;
    if (!stage) continue;
    await enqueueStage(j.id, stage, { nonce: `recover-${Date.now().toString(36)}` });
    n++;
  }
  if (n) logger.info("re-enqueued interrupted jobs", { count: n });
  return n;
}
