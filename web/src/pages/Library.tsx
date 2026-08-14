import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export function Library() {
  const qc = useQueryClient();
  const { data: series = [], isLoading } = useQuery({
    queryKey: ["series"],
    queryFn: api.listSeries,
  });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    title_hi: "",
    input_path: "",
    reading_dir: "ltr",
    format: "",
  });

  const create = useMutation({
    mutationFn: () =>
      api.createSeries({
        ...form,
        format: form.format || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["series"] });
      setOpen(false);
    },
  });

  return (
    <div className="max-w-6xl mx-auto px-5 py-10">
      <div className="mb-10">
        <h1 className="font-display text-5xl md:text-6xl leading-none mb-3">Localiser</h1>
        <p className="text-ink/70 max-w-xl text-lg">
          Hindi manga localization studio — bible, story, clean bubbles, typeset Devanagari.
          Artwork stays untouched outside approved masks.
        </p>
        {health?.models && (
          <p className="mt-3 text-xs font-mono text-ink/45">
            models · {Object.entries(health.models).map(([k, v]) => `${k}:${v}`).join(" · ")}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-2xl">Series</h2>
        <button
          onClick={() => setOpen(true)}
          className="bg-indigo text-paper px-4 py-2 text-sm hover:bg-ink transition"
        >
          Add series
        </button>
      </div>

      {isLoading && <p className="text-ink/50">Loading…</p>}
      {!isLoading && series.length === 0 && (
        <div className="border border-dashed border-halftone p-12 text-center text-ink/60">
          No series yet — drop a manga folder to start.
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {series.map((s: any) => (
          <Link
            key={s.id}
            to={`/series/${s.id}/chapters`}
            className="block group border border-halftone bg-paper/60 hover:border-indigo transition"
          >
            <div className="aspect-[3/4] bg-halftone/40 overflow-hidden">
              {s.cover ? (
                <img src={s.cover} alt="" className="w-full h-full object-cover object-top" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-ink/30 font-display text-3xl">
                  {s.title?.[0]}
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="font-display text-xl group-hover:text-indigo">{s.title}</div>
              {s.title_hi && <div className="text-sm text-ink/60">{s.title_hi}</div>}
              <div className="mt-2 flex items-center gap-2 text-xs font-mono text-ink/50">
                <span>{s.chapter_count} ch</span>
                <span>·</span>
                <span>{Math.round((s.progress || 0) * 100)}%</span>
                {s.bible_locked ? (
                  <span className="text-sage">bible locked</span>
                ) : (
                  <span className="text-vermilion">bible open</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 p-4">
          <div className="bg-paper border border-halftone w-full max-w-lg p-6 shadow-xl">
            <h3 className="font-display text-2xl mb-4">Add series</h3>
            <div className="space-y-3">
              {(
                [
                  ["title", "Title"],
                  ["title_hi", "Title (Hindi)"],
                  ["input_path", "Folder path (absolute)"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="block text-sm">
                  <span className="text-ink/60">{label}</span>
                  <input
                    className="mt-1 w-full border border-halftone bg-paper px-3 py-2"
                    value={(form as any)[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  />
                </label>
              ))}
              <div className="flex gap-3">
                <label className="text-sm flex-1">
                  Reading
                  <select
                    className="mt-1 w-full border border-halftone px-3 py-2 bg-paper"
                    value={form.reading_dir}
                    onChange={(e) => setForm({ ...form, reading_dir: e.target.value })}
                  >
                    <option value="ltr">LTR</option>
                    <option value="rtl">RTL</option>
                  </select>
                </label>
                <label className="text-sm flex-1">
                  Format
                  <select
                    className="mt-1 w-full border border-halftone px-3 py-2 bg-paper"
                    value={form.format}
                    onChange={(e) => setForm({ ...form, format: e.target.value })}
                  >
                    <option value="">Auto-detect</option>
                    <option value="page">Page</option>
                    <option value="longstrip">Longstrip</option>
                  </select>
                </label>
              </div>
            </div>
            {create.error && (
              <p className="text-vermilion text-sm mt-3">{String(create.error)}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="px-3 py-2 text-sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="bg-indigo text-paper px-4 py-2 text-sm disabled:opacity-50"
                disabled={!form.title || !form.input_path || create.isPending}
                onClick={() => create.mutate()}
              >
                Ingest
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
