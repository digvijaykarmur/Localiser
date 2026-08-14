import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, subscribeJob } from "../api";

export default function ExportScreen() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const blockers = useQuery({
    queryKey: ["blockers", seriesId],
    queryFn: () => api.exportBlockers(seriesId!),
  });
  const series = useQuery({ queryKey: ["seriesOne", seriesId], queryFn: () => api.getSeries(seriesId!) });
  const [includeStory, setIncludeStory] = useState(true);
  const [includeBible, setIncludeBible] = useState(true);
  const [overrideText, setOverrideText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const list = blockers.data?.blockers ?? [];
  const hasBlockers = list.length > 0;
  const overrideOk = overrideText === "EXPORT ANYWAY";

  async function run() {
    setBusy(true);
    setLog([]);
    try {
      const res = await api.exportSeries(seriesId!, {
        include_story: includeStory,
        include_bible: includeBible,
        override_blockers: hasBlockers && overrideOk,
      });
      if (res.status === "blocked") {
        setLog(res.blockers.map((b: any) => `BLOCKED — ${b.kind}: ${b.detail ?? b.page ?? ""}`));
      } else if (res.job_id) {
        subscribeJob(res.job_id, (e) => {
          if (e.type === "log") setLog((l) => [...l, e.line]);
          if (e.type === "state" && e.state) setLog((l) => [...l, `state: ${e.state}`]);
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="font-display text-2xl font-bold mb-2">Export</h1>
      <div className="mb-4 text-sm">
        rights_status:{" "}
        <span className={`badge ${series.data?.rights_status === "internal_test" ? "bg-vermilion/10 text-vermilion" : "bg-sage/20 text-sage"}`}>
          {series.data?.rights_status}
        </span>
      </div>

      <div className="border border-halftone rounded-lg bg-white p-4 mb-4">
        <h2 className="font-medium mb-2">Blockers</h2>
        {list.length === 0 && <div className="text-sage text-sm">✔ No blockers — ready to export.</div>}
        <ul className="text-sm space-y-1">
          {list.map((b: any, i: number) => (
            <li key={i} className="text-vermilion">
              ✘ <b>{b.kind}</b> — {b.detail ?? b.page ?? b.chapter}
            </li>
          ))}
        </ul>
        {hasBlockers && (
          <div className="mt-3 text-sm">
            To override, type <span className="font-mono bg-halftone/30 px-1">EXPORT ANYWAY</span>:
            <input
              className="block mt-1 px-2 py-1 border border-halftone rounded font-mono"
              value={overrideText}
              onChange={(e) => setOverrideText(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="border border-halftone rounded-lg bg-white p-4 mb-4 text-sm space-y-2">
        <label className="block">
          <input type="checkbox" checked={includeStory} onChange={(e) => setIncludeStory(e.target.checked)} /> Include
          Hindi stories (_story/)
        </label>
        <label className="block">
          <input type="checkbox" checked={includeBible} onChange={(e) => setIncludeBible(e.target.checked)} /> Include
          bible (_bible/)
        </label>
      </div>

      <button className="btn btn-primary" disabled={busy || (hasBlockers && !overrideOk)} onClick={run}>
        Export to output/
      </button>

      {log.length > 0 && (
        <pre className="mt-4 p-3 bg-ink text-paper rounded text-xs overflow-x-auto">{log.join("\n")}</pre>
      )}
    </div>
  );
}
