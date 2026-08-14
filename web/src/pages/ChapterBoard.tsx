import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";

const STAGES = ["analyze", "bible", "story", "translate", "clean", "typeset"] as const;

export function ChapterBoard() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data: series } = useQuery({ queryKey: ["series", id], queryFn: () => api.getSeries(id) });
  const { data: chapters = [] } = useQuery({
    queryKey: ["chapters", id],
    queryFn: () => api.chapters(id),
  });

  const run = useMutation({
    mutationFn: async ({ chapterId, stages }: { chapterId: string; stages: string[] }) => {
      const est = await api.runChapter(chapterId, stages, false);
      if ((est as any).needs_confirm) {
        const ok = confirm(
          `Approx ${(est as any).estimate?.approx_calls} Vertex calls on latest models.\nProceed?`
        );
        if (!ok) return est;
        return api.runChapter(chapterId, stages, true);
      }
      return est;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chapters", id] }),
  });

  return (
    <div className="max-w-6xl mx-auto px-5 py-8">
      <div className="mb-8">
        <h1 className="font-display text-4xl">{series?.title || "Chapters"}</h1>
        <p className="text-ink/60 mt-1">
          Pipeline board — click a stage cell to run it. Bible must be locked before translate/story.
        </p>
        <div className="mt-3 flex gap-3 text-sm">
          <Link className="text-indigo underline" to={`/series/${id}/bible`}>
            {series?.bible_locked ? "Bible locked ✓" : "Open Bible Editor"}
          </Link>
          <Link className="text-indigo underline" to={`/series/${id}/export`}>
            Export
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto border border-halftone">
        <table className="w-full text-sm">
          <thead className="bg-halftone/30">
            <tr>
              <th className="text-left p-3 font-ui">Chapter</th>
              {STAGES.map((s) => (
                <th key={s} className="p-3 font-ui capitalize text-left">{s}</th>
              ))}
              <th className="p-3 text-left">Pages</th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((ch: any) => (
              <tr key={ch.id} className="border-t border-halftone/70">
                <td className="p-3">
                  <div className="font-medium">{ch.title_src || `Ch ${ch.number}`}</div>
                  <div className="text-xs font-mono text-ink/45">{ch.state} · {ch.story_words || 0}w</div>
                  <Link className="text-xs text-indigo" to={`/series/${id}/story/${encodeURIComponent(ch.id)}`}>
                    Story
                  </Link>
                </td>
                {STAGES.map((s) => (
                  <td key={s} className="p-2">
                    <button
                      className="text-xs border border-halftone px-2 py-1 hover:border-indigo disabled:opacity-40"
                      disabled={run.isPending || ((s === "translate" || s === "story") && !series?.bible_locked)}
                      onClick={() => run.mutate({ chapterId: ch.id, stages: [s] })}
                    >
                      Run
                    </button>
                  </td>
                ))}
                <td className="p-3">
                  <div className="flex flex-wrap gap-1 max-w-[220px]">
                    {(ch.pages || []).map((p: any) => (
                      <Link
                        key={p.id}
                        to={`/series/${id}/pages/${encodeURIComponent(p.id)}`}
                        className={`w-2.5 h-2.5 rounded-sm ${
                          p.flagged
                            ? "bg-vermilion"
                            : p.state === "approved"
                              ? "bg-sage"
                              : p.state === "new"
                                ? "bg-halftone"
                                : "bg-amber-500"
                        }`}
                        title={`${p.id} · ${p.state}`}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <button
          className="bg-indigo text-paper px-4 py-2 text-sm disabled:opacity-40"
          disabled={!chapters.length || run.isPending || !series?.bible_locked}
          onClick={() => {
            const stages = ["analyze", "translate", "clean", "typeset", "story"];
            chapters.forEach((ch: any) => run.mutate({ chapterId: ch.id, stages }));
          }}
        >
          Run everything (locked bible required)
        </button>
        {run.error && <p className="text-vermilion text-sm mt-2">{String(run.error)}</p>}
      </div>
    </div>
  );
}
