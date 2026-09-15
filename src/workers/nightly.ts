import { log } from "@/lib/log";
import { computeAllTiers } from "@/services/metrics/ppp";
import { syncOutcomes } from "@/services/tracker/outcomes";
import { runCanary } from "@/services/metrics/canary";

const logger = log("nightly");

export async function runNightly(name: string): Promise<void> {
  logger.info("maintenance job", { name });
  if (name === "ppp") await computeAllTiers();
  else if (name === "outcomes") await syncOutcomes(30);
  else if (name === "canary") await runCanary();
}
