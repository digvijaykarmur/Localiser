import { notFound } from "next/navigation";
import { PromoError } from "@/domain";
import { getJobView } from "@/services/pipeline/jobs";
import { deliveryView } from "@/services/tracker/delivery";
import { reviewQueue } from "@/services/tracker/review";
import { JobScreen } from "@/components/JobScreen";
import type { DeliveryView } from "@/components/DeliveryPanel";

export const dynamic = "force-dynamic";

const TABS = new Set(["stages", "plan", "timeline", "preview", "review"]);

export default async function JobPage({ params, searchParams }: { params: { jobId: string }; searchParams: { tab?: string } }) {
  let job;
  try {
    job = await getJobView(params.jobId);
  } catch (e) {
    if (e instanceof PromoError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const [queue, delivery] = await Promise.all([reviewQueue(), job.promo_id ? deliveryView(job.promo_id).catch(() => null) : Promise.resolve(null)]);
  const requested = searchParams.tab && TABS.has(searchParams.tab) ? (searchParams.tab as "stages" | "plan" | "timeline" | "preview" | "review") : null;
  const initialTab = requested ?? (job.promo ? "review" : job.stage === "READY" ? "preview" : "stages");
  return <JobScreen initial={job} queue={queue} delivery={delivery as DeliveryView | null} initialTab={initialTab} />;
}
