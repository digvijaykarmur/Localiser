import { jsonOk, jsonError } from "@/lib/http";
import { MetricsSummary } from "@/domain";
import { metricsSummary } from "@/services/ledger";

export async function GET() {
  try {
    const summary = await metricsSummary();
    return jsonOk(MetricsSummary, summary);
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
