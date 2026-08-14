import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, subscribeJob } from "../api";

const STAGES = ["analyze", "bible", "story", "translate", "clean", "typeset", "qc"] as const;

export default function ChapterBoard() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const qc = useQueryClient();
  const chapters = useQuery({
    queryKey: ["chapters", seriesId],
    queryFn: () => api.listChapters(seriesId!),
    refetchInterval: 5000,
  });
  const [estimate, setEstimate] = useState<any>(null);
  const [pendingRun, setPendingRun] = useState<{ chapterId: string; stages: string[] } | null>(null);
  const [progress, setProgress] = useState<Record<string, { pct: number; log: string[] }>>({});

  async function requestRun(chapterId: string, stages: string[]) {
    const res = await api.runChapter(chapterId, stages, false);
    if (res.needs_confirm) {
      setEstimate(res.estimate);
      setPendingRun({ chapterId, stages });
    }
  }

  async function confirmRun() {
    if (!pendingRun) return;
    const { chapterId, stages } = pendingRun;
    setPendingRun(null);
    setEstimate(null);
    const res = await api.runChapter(chapterId, stages, true);
    if (res.job_id) {
      subscribeJob(res.job_id, (e) => {
        setProgress((p) => {
          const cur = p[chapterId] ?? { pct: 0, log: [] };
          if (e.type === "progress") cur.pct = e.completed / Math.max(1, e.total);
          if (e.type === "log") cur.log = [...cur.log.slice(-4), e.line];
          if (e.type === "error") cur.log = [...cur.log.slice(-4), `ERROR ${e.page}: ${e.error}`];
          if (e.type === "end") qc.invalidateQueries({ queryKey: ["chapters", seriesId] });
          return { ...p, [chapterId]: { ...cur } };
        });
      });
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="font-display text-2xl font-bold mb-4">Chapters</h1>
      <div className="space-y-2">
        {chapters.data?.map((ch) => {
          const prog = progress[ch.id];
          return (
            <div key={ch.id} className="border border-halftone rounded-lg bg-white p-3">
              <div className="flex items-center gap-3">
                <div className="font-display font-bold w-24">Ch {ch.number}</div>
                <span className="badge bg-halftone/40">{ch.state}</span>
                {ch.story_words > 0 && (
                  <span
                    className={`badge ${ch.story_words >= 2000 ? "bg-sage/20 text-sage" : "bg-vermilion/10 text-vermilion"}`}
                  >
                    story {ch.story_words}w
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {STAGES.map((st) => (
                    <button
                      key={st}
                      className="btn text-xs px-2 py-1"
                      onClick={() => requestRun(ch.id, [st])}
                    >
                      {st}
                    </button>
                  ))}
                  <button
                    className="btn btn-primary text-xs px-2 py-1"
                    onClick={() => requestRun(ch.id, [...STAGES])}
                  >
                    Run all
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                {prog && prog.pct > 0 && prog.pct < 1 && (
                  <div className="flex-1 h-1.5 bg-halftone/40 rounded overflow-hidden">
                    <div
                      className="h-full bg-indigo transition-all"
                      style={{ width: `${prog.pct * 100}%` }}
                    />
                  </div>
                )}
                <div className="flex gap-2 text-sm">
                  {Array.from({ length: ch.page_count ?? 0 }, (_, i) => i + 1)
                    .slice(0, 30)
                    .map((i) => {
                      const idx = String(i).padStart(3, "0");
                      return (
                        <Link
                          key={i}
                          className="text-indigo hover:underline font-mono text-xs"
                          to={`/series/${seriesId}/${ch.id.split("/")[1]}/pages/${idx}`}
                        >
                          {idx}
                        </Link>
                      );
                    })}
                  {(ch.page_count ?? 0) > 30 && <span className="text-ink/40">…</span>}
                </div>
                <Link
                  className="ml-auto text-sm text-indigo hover:underline"
                  to={`/series/${seriesId}/${ch.id.split("/")[1]}/story`}
                >
                  Story →
                </Link>
              </div>
              {prog?.log?.length ? (
                <div className="mt-1 font-mono text-[11px] text-ink/50">
                  {prog.log[prog.log.length - 1]}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {estimate && pendingRun && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-paper rounded-lg p-6 w-96 border border-halftone">
            <h2 className="font-display font-bold mb-2">Confirm run</h2>
            <p className="text-sm mb-1">
              Stages: <span className="font-mono">{estimate.stages.join(", ")}</span>
            </p>
            <p className="text-sm mb-1">Pages: {estimate.pages}</p>
            <p className="text-sm mb-4">
              Estimated model calls: <b>{estimate.estimated_calls}</b>
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setPendingRun(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={confirmRun}>
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
