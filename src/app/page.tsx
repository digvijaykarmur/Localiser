import { listTitles } from "@/services/titles";
import { listJobs } from "@/services/pipeline/jobs";
import { reviewQueue } from "@/services/tracker/review";
import { deliveryQueue } from "@/services/tracker/delivery";
import { ConnectionStrip } from "@/components/ConnectionStrip";
import { Library } from "@/components/Library";
import { checkConnectionsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const [titles, jobs, queue, delivery] = await Promise.all([listTitles(), listJobs(20), reviewQueue(), deliveryQueue()]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-[18px] font-semibold">Library</h1>
        <ConnectionStrip initial={null} check={checkConnectionsAction} />
      </div>
      <Library titles={titles} jobs={jobs} queue={queue} delivery={delivery} />
    </div>
  );
}
