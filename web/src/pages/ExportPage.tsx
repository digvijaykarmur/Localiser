import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";

export function ExportPage() {
  const { id = "" } = useParams();
  const { data: blockers = [], refetch } = useQuery({
    queryKey: ["blockers", id],
    queryFn: () => api.exportBlockers(id),
  });
  const { data: series } = useQuery({ queryKey: ["series", id], queryFn: () => api.getSeries(id) });
  const { data: cost } = useQuery({ queryKey: ["cost", id], queryFn: () => api.cost(id) });
  const [override, setOverride] = useState(false);
  const [result, setResult] = useState("");

  const hard = blockers.filter((b: any) => !b.soft);
  const disabled = hard.some((b: any) => b.code === "budget_violation") || (hard.length > 0 && !override);

  const run = useMutation({
    mutationFn: () =>
      api.exportSeries({
        series_id: id,
        include_story: true,
        include_bible: true,
        include_qa: true,
        override_blockers: override,
        override_phrase: override ? "EXPORT ANYWAY" : null,
      }),
    onSuccess: (r: any) => {
      setResult(r.path);
      refetch();
    },
  });

  return (
    <div className="max-w-3xl mx-auto px-5 py-10">
      <h1 className="font-display text-4xl mb-2">Export</h1>
      <p className="text-ink/60 mb-6">
        Writes <code className="font-mono text-sm">output/{series?.title}/Chapter NN/*.png</code> plus
        stories, bible, QA. Rights: <strong>{series?.rights_status}</strong>
      </p>

      <div className="border border-halftone p-4 mb-6">
        <h2 className="font-display text-xl mb-3">Blockers</h2>
        {!blockers.length && <p className="text-sage text-sm">No blockers — ready to export.</p>}
        <ul className="space-y-2">
          {blockers.map((b: any, i: number) => (
            <li key={i} className={`text-sm ${b.soft ? "text-ink/50" : "text-vermilion"}`}>
              [{b.code}] {b.msg}
            </li>
          ))}
        </ul>
        {hard.length > 0 && !hard.some((b: any) => b.code === "budget_violation") && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Override soft blockers (type confirm on export)
          </label>
        )}
      </div>

      <div className="border border-halftone p-4 mb-6 text-sm font-mono text-ink/60">
        Cost estimate · ${Number(cost?.total_usd_est || 0).toFixed(4)} · {cost?.calls || 0} calls
      </div>

      <button
        className="bg-indigo text-paper px-5 py-2.5 text-sm disabled:opacity-40"
        disabled={disabled || run.isPending}
        onClick={() => run.mutate()}
      >
        Export to output/
      </button>
      {run.error && <p className="text-vermilion text-sm mt-3">{String(run.error)}</p>}
      {result && <p className="text-sage text-sm mt-3 font-mono">{result}</p>}
    </div>
  );
}
