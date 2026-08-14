import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";

const TABS = ["Series", "Characters", "Entities", "Places", "Glossary", "SFX", "Registers"] as const;

export default function BibleEditor() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const qc = useQueryClient();
  const bq = useQuery({ queryKey: ["bible", seriesId], queryFn: () => api.getBible(seriesId!) });
  const inbox = useQuery({
    queryKey: ["inbox", seriesId],
    queryFn: () => api.bibleInbox(seriesId!),
  });
  const [tab, setTab] = useState<(typeof TABS)[number]>("Characters");
  const [bible, setBible] = useState<any>(null);
  const [showLockDialog, setShowLockDialog] = useState(false);

  useEffect(() => {
    if (bq.data?.bible) setBible(bq.data.bible);
  }, [bq.data]);

  const save = useMutation({
    mutationFn: () => api.putBible(seriesId!, bible),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bible", seriesId] }),
  });
  const lock = useMutation({
    mutationFn: () => api.lockBible(seriesId!),
    onSuccess: () => {
      setShowLockDialog(false);
      qc.invalidateQueries({ queryKey: ["bible", seriesId] });
    },
  });

  if (!bible)
    return (
      <div className="p-8 text-ink/60">
        {bq.isLoading ? "Loading…" : "No bible yet — run the Bible stage on Chapter 1 first."}
      </div>
    );

  const locked = bq.data?.locked;
  const chars = bible.characters ?? [];
  const canLock = chars.length > 0 && chars.every((c: any) => c.register && c.name_hi);
  const pendingInbox = (inbox.data?.items ?? []).filter((i: any) => i.status === "pending");

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-display text-2xl font-bold">Bible</h1>
        {locked ? (
          <span className="badge bg-sage/20 text-sage">locked · v{bible.version}</span>
        ) : (
          <span className="badge bg-vermilion/10 text-vermilion">draft — approval gate open</span>
        )}
        <div className="ml-auto flex gap-2">
          {pendingInbox.length > 0 && (
            <span className="badge bg-indigo/10 text-indigo">Inbox: {pendingInbox.length}</span>
          )}
          <button className="btn" onClick={() => save.mutate()} disabled={save.isPending}>
            Save draft
          </button>
          {!locked && (
            <button
              className="btn btn-primary"
              disabled={!canLock}
              title={canLock ? "" : "Every character needs a register and a name_hi"}
              onClick={() => setShowLockDialog(true)}
            >
              Lock Bible
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-halftone">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm ${
              tab === t ? "border-b-2 border-indigo font-medium" : "text-ink/60"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Characters" && (
        <div className="grid md:grid-cols-2 gap-4">
          {chars.map((c: any, i: number) => (
            <CharacterCard
              key={c.id ?? i}
              c={c}
              seriesId={seriesId!}
              registers={Object.keys(bible.registers ?? {})}
              locked={locked}
              onChange={(nc) => {
                const next = [...chars];
                next[i] = nc;
                setBible({ ...bible, characters: next });
              }}
            />
          ))}
        </div>
      )}

      {tab === "Glossary" && (
        <KeyValueList
          items={bible.glossary ?? []}
          keys={["src", "hi"]}
          onChange={(items) => setBible({ ...bible, glossary: items })}
        />
      )}
      {tab === "SFX" && (
        <KeyValueList
          items={bible.sfx_map ?? []}
          keys={["src", "hi"]}
          onChange={(items) => setBible({ ...bible, sfx_map: items })}
        />
      )}
      {tab === "Places" && (
        <KeyValueList
          items={bible.places ?? []}
          keys={["id", "name_hi", "desc_hi"]}
          onChange={(items) => setBible({ ...bible, places: items })}
        />
      )}
      {tab === "Entities" && (
        <KeyValueList
          items={bible.entities ?? []}
          keys={["id", "name_hi", "register"]}
          onChange={(items) => setBible({ ...bible, entities: items })}
        />
      )}
      {tab === "Series" && (
        <textarea
          className="w-full h-96 font-mono text-xs p-3 border border-halftone rounded bg-white"
          value={JSON.stringify(bible.series ?? {}, null, 2)}
          onChange={(e) => {
            try {
              setBible({ ...bible, series: JSON.parse(e.target.value) });
            } catch {
              /* keep typing */
            }
          }}
        />
      )}
      {tab === "Registers" && (
        <textarea
          className="w-full h-96 font-mono text-xs p-3 border border-halftone rounded bg-white"
          value={JSON.stringify(bible.registers ?? {}, null, 2)}
          onChange={(e) => {
            try {
              setBible({ ...bible, registers: JSON.parse(e.target.value) });
            } catch {
              /* keep typing */
            }
          }}
        />
      )}

      {pendingInbox.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display font-bold mb-2">Bible Inbox</h2>
          {pendingInbox.map((item: any) => (
            <div
              key={item.id}
              className="flex items-start gap-3 border border-halftone rounded p-3 mb-2 bg-white"
            >
              <span className="badge bg-indigo/10 text-indigo">{item.kind}</span>
              <pre className="flex-1 text-xs font-mono whitespace-pre-wrap">
                {JSON.stringify(item.payload, null, 1)}
              </pre>
              <button
                className="btn"
                onClick={() =>
                  api.inboxAction(seriesId!, item.id, "accept").then(() => inbox.refetch())
                }
              >
                Accept
              </button>
              <button
                className="btn btn-danger"
                onClick={() =>
                  api.inboxAction(seriesId!, item.id, "reject").then(() => inbox.refetch())
                }
              >
                Reject
              </button>
            </div>
          ))}
        </div>
      )}

      {showLockDialog && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-paper rounded-lg p-6 w-[30rem] border border-halftone">
            <h2 className="font-display font-bold mb-2">Lock the Bible?</h2>
            <p className="text-sm mb-2">
              Locking <b>enables</b>: translation, story generation, and full-chapter runs.
            </p>
            <p className="text-sm mb-4">
              <b>Cannot change afterwards</b>: name_policy, locked character names, locked glossary
              spellings. Later chapters can only <i>propose</i> additions via the Inbox.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setShowLockDialog(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => lock.mutate()}>
                Lock Bible
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterCard({
  c,
  seriesId,
  registers,
  locked,
  onChange,
}: {
  c: any;
  seriesId: string;
  registers: string[];
  locked: boolean;
  onChange: (c: any) => void;
}) {
  const [sample, setSample] = useState("");
  const [preview, setPreview] = useState("");
  const timer = useRef<number | undefined>(undefined);

  // live register preview, debounced 600ms
  useEffect(() => {
    if (!sample.trim()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api
        .registerPreview(seriesId, c.id, sample)
        .then((d) => setPreview(d.hindi))
        .catch(() => setPreview("(preview failed — check Vertex auth)"));
    }, 600);
    return () => window.clearTimeout(timer.current);
  }, [sample, c.id, seriesId]);

  return (
    <div className="border border-halftone rounded-lg p-4 bg-white">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-xs text-ink/50">{c.id}</span>
        {c.locked && <span className="badge bg-sage/20 text-sage">locked</span>}
        <span className="ml-auto text-sm text-ink/60">{c.role}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <label className="text-xs">
          name_hi
          <input
            className="w-full mt-0.5 px-2 py-1 border border-halftone rounded font-deva"
            value={c.name_hi ?? ""}
            disabled={locked && c.locked}
            onChange={(e) => onChange({ ...c, name_hi: e.target.value })}
          />
        </label>
        <label className="text-xs">
          register
          <select
            className="w-full mt-0.5 px-2 py-1 border border-halftone rounded"
            value={c.register ?? ""}
            onChange={(e) => onChange({ ...c, register: e.target.value })}
          >
            <option value="">—</option>
            {registers.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-xs block mb-2">
        visual_key
        <textarea
          className="w-full mt-0.5 px-2 py-1 border border-halftone rounded font-deva text-sm"
          rows={2}
          value={c.visual_key ?? ""}
          onChange={(e) => onChange({ ...c, visual_key: e.target.value })}
        />
      </label>
      <label className="text-xs block mb-2">
        speech_rules (one per line)
        <textarea
          className="w-full mt-0.5 px-2 py-1 border border-halftone rounded font-deva text-sm"
          rows={3}
          value={(c.speech_rules ?? []).join("\n")}
          onChange={(e) =>
            onChange({ ...c, speech_rules: e.target.value.split("\n").filter(Boolean) })
          }
        />
      </label>
      <div className="border-t border-halftone pt-2 mt-2">
        <div className="text-xs text-ink/60 mb-1">Register preview — type an English line:</div>
        <input
          className="w-full px-2 py-1 border border-halftone rounded text-sm"
          placeholder="e.g. Seriously? This system is amazing!"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        {preview && <div className="font-deva mt-1 text-indigo">{preview}</div>}
      </div>
    </div>
  );
}

function KeyValueList({
  items,
  keys,
  onChange,
}: {
  items: any[];
  keys: string[];
  onChange: (items: any[]) => void;
}) {
  return (
    <div>
      <table className="w-full text-sm bg-white border border-halftone rounded">
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k} className="text-left px-2 py-1 border-b border-halftone font-mono text-xs">
                {k}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td key={k} className="px-1 py-0.5 border-b border-halftone/50">
                  <input
                    className="w-full px-1 py-0.5 font-deva"
                    value={it[k] ?? ""}
                    onChange={(e) => {
                      const next = [...items];
                      next[i] = { ...it, [k]: e.target.value };
                      onChange(next);
                    }}
                  />
                </td>
              ))}
              <td className="px-1 border-b border-halftone/50">
                <button
                  className="text-vermilion text-xs"
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn mt-2"
        onClick={() => onChange([...items, Object.fromEntries(keys.map((k) => [k, ""]))])}
      >
        + add
      </button>
    </div>
  );
}
