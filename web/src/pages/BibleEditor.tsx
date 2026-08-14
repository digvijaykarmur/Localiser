import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";

const TABS = ["Series", "Characters", "Entities", "Places", "Glossary", "SFX", "Registers"] as const;

export function BibleEditor() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["bible", id], queryFn: () => api.getBible(id) });
  const [tab, setTab] = useState<(typeof TABS)[number]>("Characters");
  const [bible, setBible] = useState<any>(null);
  const [previewChar, setPreviewChar] = useState("");
  const [sample, setSample] = useState("What is going on here?");
  const [previewOut, setPreviewOut] = useState("");

  useEffect(() => {
    if (data?.bible) setBible(data.bible);
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.putBible(id, bible),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bible", id] }),
  });
  const lock = useMutation({
    mutationFn: () => api.lockBible(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bible", id] });
      qc.invalidateQueries({ queryKey: ["series"] });
    },
  });

  useEffect(() => {
    if (!previewChar || !sample) return;
    const t = setTimeout(() => {
      api.biblePreview(id, previewChar, sample).then((r: any) => setPreviewOut(r.text || "")).catch(() => setPreviewOut("(Vertex offline — set credentials in .env)"));
    }, 600);
    return () => clearTimeout(t);
  }, [id, previewChar, sample]);

  if (!bible) return <div className="p-8 text-ink/50">Loading bible…</div>;

  const canLock =
    (bible.characters || []).length > 0 &&
    (bible.characters || []).every((c: any) => c.name_hi && c.register);

  return (
    <div className="max-w-6xl mx-auto px-5 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-4xl">Series Bible</h1>
          <p className="text-ink/60 mt-1">
            Approval gate — lock before any Hindi dialogue or story runs.
            {data?.locked ? ` Locked v${data.version}` : " Draft"}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="border border-halftone px-3 py-2 text-sm" onClick={() => save.mutate()}>
            Save draft
          </button>
          <button
            className="bg-sage text-paper px-4 py-2 text-sm disabled:opacity-40"
            disabled={!canLock || data?.locked}
            onClick={() => {
              if (confirm("Locking freezes names and name_policy. Downstream stages unlock. Continue?"))
                lock.mutate();
            }}
          >
            Lock Bible
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm border ${tab === t ? "border-indigo bg-indigo/10" : "border-halftone"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Series" && (
        <div className="space-y-3 max-w-xl">
          <Field label="Title (HI)" value={bible.series?.title_hi || ""} onChange={(v) => setBible({ ...bible, series: { ...bible.series, title_hi: v } })} />
          <Field label="Logline (HI)" value={bible.series?.logline_hi || ""} onChange={(v) => setBible({ ...bible, series: { ...bible.series, logline_hi: v } })} />
          <Field label="Tone" value={bible.series?.tone || ""} onChange={(v) => setBible({ ...bible, series: { ...bible.series, tone: v } })} />
        </div>
      )}

      {tab === "Characters" && (
        <div className="grid lg:grid-cols-2 gap-4">
          {(bible.characters || []).map((c: any, i: number) => (
            <div key={c.id || i} className="border border-halftone p-4 bg-paper/70">
              <div className="font-mono text-xs text-ink/40 mb-2">{c.id}</div>
              <Field label="name_hi" value={c.name_hi || ""} onChange={(v) => {
                const characters = [...bible.characters];
                characters[i] = { ...c, name_hi: v };
                setBible({ ...bible, characters });
              }} />
              <Field label="visual_key" value={c.visual_key || ""} onChange={(v) => {
                const characters = [...bible.characters];
                characters[i] = { ...c, visual_key: v };
                setBible({ ...bible, characters });
              }} />
              <Field label="register" value={c.register || ""} onChange={(v) => {
                const characters = [...bible.characters];
                characters[i] = { ...c, register: v };
                setBible({ ...bible, characters });
                setPreviewChar(c.id);
              }} />
              <button className="text-xs text-indigo mt-2" onClick={() => setPreviewChar(c.id)}>Use in register preview</button>
            </div>
          ))}
        </div>
      )}

      {tab === "Glossary" && (
        <pre className="text-xs font-mono bg-ink/5 p-4 overflow-auto max-h-96">{JSON.stringify(bible.glossary || [], null, 2)}</pre>
      )}
      {tab === "SFX" && (
        <pre className="text-xs font-mono bg-ink/5 p-4 overflow-auto max-h-96">{JSON.stringify(bible.sfx_map || [], null, 2)}</pre>
      )}
      {tab === "Registers" && (
        <pre className="text-xs font-mono bg-ink/5 p-4 overflow-auto max-h-96">{JSON.stringify(bible.registers || {}, null, 2)}</pre>
      )}
      {tab === "Entities" && (
        <pre className="text-xs font-mono bg-ink/5 p-4 overflow-auto max-h-96">{JSON.stringify(bible.entities || [], null, 2)}</pre>
      )}
      {tab === "Places" && (
        <pre className="text-xs font-mono bg-ink/5 p-4 overflow-auto max-h-96">{JSON.stringify(bible.places || [], null, 2)}</pre>
      )}

      <div className="mt-10 border border-halftone p-5 bg-paper/80">
        <h3 className="font-display text-xl mb-2">Register Preview</h3>
        <p className="text-sm text-ink/55 mb-3">Type any English line — see the Hindi this character would produce.</p>
        <div className="flex gap-3 flex-wrap">
          <input className="flex-1 border border-halftone px-3 py-2 min-w-[200px]" value={sample} onChange={(e) => setSample(e.target.value)} />
          <select className="border border-halftone px-3 py-2 bg-paper" value={previewChar} onChange={(e) => setPreviewChar(e.target.value)}>
            <option value="">Character…</option>
            {(bible.characters || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.name_hi || c.id}</option>
            ))}
          </select>
        </div>
        <div className="mt-3 text-lg leading-relaxed min-h-[2.5rem]">{previewOut}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm mb-2">
      <span className="text-ink/50">{label}</span>
      <input className="mt-1 w-full border border-halftone bg-paper px-3 py-2" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
