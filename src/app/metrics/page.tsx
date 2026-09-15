import { Dashboard } from "@/components/Dashboard";
import { readBaseline } from "@/services/metrics/baseline";
import { metricsSummary } from "@/services/metrics/summary";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const summary = await metricsSummary(readBaseline());
  return <Dashboard summary={summary} />;
}
