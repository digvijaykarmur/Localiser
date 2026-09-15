import { metricsSummary } from "@/services/metrics/summary";
import { readBaseline } from "@/services/metrics/baseline";
import { ok, route } from "../../../_lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/metrics/summary — the five numbers per (format, dialect), plus judge correlation and PPP tiers. */
export const GET = route(async () => ok(await metricsSummary(readBaseline())));
