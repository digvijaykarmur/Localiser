import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

export default function Library() {
  const qc = useQueryClient();
  const series = useQuery({ queryKey: ["series"], queryFn: api.listSeries });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    title: "",
    title_hi: "",
    input_path: "",
    reading_dir: "ltr",
    format: "page",
    rights_status: "internal_test",
  });
  const create = useMutation({
    mutationFn: () => api.createSeries(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["series"] });
      setShowAdd(false);
    },
  });

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold">Library</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
          Add series
        </button>
      </div>

      {series.data?.length === 0 && (
        <div className="halftone-edge rounded-lg border border-halftone p-16 text-center text-ink/60">
          No series yet — drop a manga folder to start.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {series.data?.map((s) => (
          <Link
            key={s.id}
            to={`/series/${s.id}/chapters`}
            className="border border-halftone rounded-lg bg-white overflow-hidden hover:border-indigo transition-colors"
          >
            <div className="aspect-[3/4] bg-halftone/30 overflow-hidden">
              {s.cover_page_id && (
                <img
                  src={api.pageImageUrl(s.cover_page_id, "original")}
                  className="w-full h-full object-cover object-top"
                  alt=""
                />
              )}
            </div>
            <div className="p-3">
              <div className="font-medium">{s.title}</div>
              {s.title_hi && <div className="font-deva text-sm text-ink/70">{s.title_hi}</div>}
              <div className="flex items-center gap-2 mt-2 text-xs text-ink/60">
                <span>{s.chapters} ch</span>
                <span>{s.percent_complete}%</span>
                <span
                  className={`badge ${s.bible_locked ? "bg-sage/20 text-sage" : "bg-halftone/50"}`}
                >
                  {s.bible_locked ? "bible locked" : "bible open"}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-paper rounded-lg p-6 w-[28rem] border border-halftone">
            <h2 className="font-display font-bold mb-4">Add series</h2>
            {(
              [
                ["title", "Title"],
                ["title_hi", "Title (Hindi, optional)"],
                ["input_path", "Input folder path"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="block mb-3 text-sm">
                {label}
                <input
                  className="w-full mt-1 px-2 py-1.5 border border-halftone rounded bg-white"
                  value={(form as any)[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="flex gap-3 mb-3 text-sm">
              <label>
                Reading direction
                <select
                  className="block mt-1 px-2 py-1.5 border border-halftone rounded bg-white"
                  value={form.reading_dir}
                  onChange={(e) => setForm({ ...form, reading_dir: e.target.value })}
                >
                  <option value="ltr">Left → right</option>
                  <option value="rtl">Right → left (manga)</option>
                </select>
              </label>
              <label>
                Format
                <select
                  className="block mt-1 px-2 py-1.5 border border-halftone rounded bg-white"
                  value={form.format}
                  onChange={(e) => setForm({ ...form, format: e.target.value })}
                >
                  <option value="page">Pages</option>
                  <option value="longstrip">Long strip (webtoon)</option>
                </select>
              </label>
              <label>
                Rights
                <select
                  className="block mt-1 px-2 py-1.5 border border-halftone rounded bg-white"
                  value={form.rights_status}
                  onChange={(e) => setForm({ ...form, rights_status: e.target.value })}
                >
                  <option value="internal_test">Internal test</option>
                  <option value="owned">Owned</option>
                  <option value="licensed">Licensed</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!form.title || !form.input_path || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Ingesting…" : "Ingest"}
              </button>
            </div>
            {create.error && (
              <div className="mt-2 text-vermilion text-sm">{String(create.error)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
