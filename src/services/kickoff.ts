import type { PipelineStage } from "@/domain";
import { env } from "@/lib/env";
import { runPipeline } from "@/services/pipeline";
import { enqueuePipeline } from "@/workers/index";

export async function kickoffPipeline(jobId: string, fromStage: PipelineStage = "PLAN") {
  if (env.SNAPSHOT_MODE) {
    void runPipeline(jobId, fromStage).catch((e) => console.error("pipeline", e));
    return "inline" as const;
  }
  try {
    await enqueuePipeline(jobId, fromStage);
    return "queue" as const;
  } catch (e) {
    console.error("enqueue failed, running inline", e);
    void runPipeline(jobId, fromStage).catch((err) => console.error("pipeline", err));
    return "inline" as const;
  }
}
