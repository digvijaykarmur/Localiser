import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { api } from "../lib/api";
import { RegistrationSlider } from "../components/RegistrationSlider";

export function PageReview() {
  const { id = "", pageId: rawPageId = "" } = useParams();
  const pageId = decodeURIComponent(rawPageId);
  const qc = useQueryClient();
  const { data: page } = useQuery({
    queryKey: ["page", pageId],
    queryFn: () => api.getPage(pageId),
  });
  const { data: chapters = [] } = useQuery({
    queryKey: ["chapters", id],
    queryFn: () => api.chapters(id),
  });
  const { data: notes = [], refetch: refetchNotes } = useQuery({
    queryKey: ["notes", pageId],
    queryFn: () => api.notes(pageId),
  });

  const [tab, setTab] = useState<"regions" | "chat" | "notes">("regions");
  const [selected, setSelected] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [proposed, setProposed] = useState<any>(null);
  const [view, setView] = useState<"slider" | "original" | "final" | "diff">("slider");
  const [pinMode, setPinMode] = useState(false);

  const filmstrip = useMemo(() => {
    const pages: any[] = [];
    for (const ch of chapters) for (const p of ch.pages || []) pages.push(p);
    return pages;
  }, [chapters]);

  const selectedRegion = page?.regions?.find((r: any) => r.id === selected);

  const patch = useMutation({
    mutationFn: (body: any) => api.patchRegion(selected!, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["page", pageId] }),
  });

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!page?.regions?.length) return;
      const idx = page.regions.findIndex((r: any) => r.id === selected);
      if (e.key === "j" || e.key === "J") {
        const n = page.regions[Math.min(page.regions.length - 1, idx + 1)];
        if (n) setSelected(n.id);
      }
      if (e.key === "k" || e.key === "K") {
        const n = page.regions[Math.max(0, idx - 1)];
        if (n) setSelected(n.id);
      }
      if (e.key === "a" || e.key === "A") {
        if (selected) patch.mutate({ locked: true });
      }
      if (e.key === "z" || e.key === "Z") {
        setView((v) => (v === "original" ? "final" : "original"));
      }
    },
    [page, selected, patch]
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (!page) return <div className="p-8 text-ink/50">Loading page…</div>;

  return (
    <div className="h-[calc(100vh-57px)] grid grid-cols-[88px_1fr_320px]">
      {/* filmstrip */}
      <aside className="border-r border-halftone overflow-y-auto bg-paper/70 p-1.5 space-y-1">
        {filmstrip.map((p) => (
          <Link
            key={p.id}
            to={`/series/${id}/pages/${encodeURIComponent(p.id)}`}
            className={`block border ${p.id === pageId ? "border-indigo" : "border-transparent"}`}
          >
            <img
              src={api.imageUrl(p.id, "original")}
              alt=""
              className="w-full aspect-[3/4] object-cover object-top"
            />
            <div
              className={`h-1 ${
                p.flagged ? "bg-vermilion" : p.state === "approved" ? "bg-sage" : "bg-halftone"
              }`}
            />
          </Link>
        ))}
      </aside>

      {/* canvas */}
      <section className="relative bg-ink/5 overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-halftone text-xs">
          {(["slider", "original", "final", "diff"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-1 border ${view === v ? "border-indigo" : "border-halftone"}`}
            >
              {v}
            </button>
          ))}
          <button
            className={`ml-auto px-2 py-1 border ${pinMode ? "border-vermilion text-vermilion" : "border-halftone"}`}
            onClick={() => setPinMode((x) => !x)}
          >
            Pin note
          </button>
          <button
            className="px-2 py-1 border border-halftone"
            onClick={() => api.rebuildPage(pageId).then(() => qc.invalidateQueries({ queryKey: ["page", pageId] }))}
          >
            Rebuild
          </button>
          <button
            className="px-2 py-1 bg-sage text-paper"
            onClick={() => api.approvePage(pageId).then(() => qc.invalidateQueries({ queryKey: ["page", pageId] }))}
          >
            Approve page
          </button>
        </div>

        <div className="flex-1 relative">
          {view === "slider" ? (
            <RegistrationSlider
              beforeUrl={api.imageUrl(pageId, "original")}
              afterUrl={api.imageUrl(pageId, page.state === "new" ? "original" : "composite")}
              regions={page.regions || []}
              selected={selected}
              onSelect={setSelected}
              notes={notes}
              onCanvasClick={
                pinMode
                  ? async (x, y) => {
                      const body = prompt("Note:");
                      if (!body) return;
                      await api.createNote({ page_id: pageId, x, y, body, region_id: selected });
                      setPinMode(false);
                      refetchNotes();
                      setTab("notes");
                    }
                  : undefined
              }
            />
          ) : (
            <TransformWrapper>
              <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full">
                <div className="relative inline-block">
                  <img
                    src={api.imageUrl(
                      pageId,
                      view === "original" ? "original" : view === "diff" ? "diff" : "composite"
                    )}
                    alt=""
                    className="max-h-[calc(100vh-110px)] mx-auto"
                  />
                </div>
              </TransformComponent>
            </TransformWrapper>
          )}
        </div>
      </section>

      {/* right rail */}
      <aside className="border-l border-halftone flex flex-col bg-paper/90">
        <div className="flex border-b border-halftone text-sm">
          {(["regions", "chat", "notes"] as const).map((t) => (
            <button
              key={t}
              className={`flex-1 py-2 capitalize ${tab === t ? "border-b-2 border-indigo" : "text-ink/50"}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {tab === "regions" && (
            <div className="space-y-2">
              {(page.regions || []).map((r: any) => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  className={`w-full text-left border p-2 ${
                    selected === r.id ? "border-indigo bg-indigo/5" : "border-halftone"
                  }`}
                >
                  <div className="flex justify-between text-xs font-mono text-ink/45">
                    <span>
                      r{String(r.ordinal).padStart(2, "0")} · {r.kind}
                    </span>
                    <span
                      className={
                        r.status === "approved"
                          ? "text-sage"
                          : r.status === "flagged"
                            ? "text-vermilion"
                            : "text-amber-600"
                      }
                    >
                      {r.status}
                    </span>
                  </div>
                  <div className="text-xs text-ink/50 mt-1 line-clamp-2">{r.src_text}</div>
                  <div className="text-sm mt-1">{r.target_text}</div>
                </button>
              ))}
            </div>
          )}

          {tab === "chat" && (
            <div className="flex flex-col h-full gap-3">
              <textarea
                className="w-full border border-halftone p-2 text-sm min-h-[100px] bg-paper"
                placeholder='जैसे: "इस बबल की भाषा ज़्यादा formal है"'
                value={chat}
                onChange={(e) => setChat(e.target.value)}
              />
              <button
                className="bg-indigo text-paper px-3 py-2 text-sm"
                onClick={async () => {
                  const res = await api.chat({
                    scope: "page",
                    scope_id: pageId,
                    message: chat,
                    selected_region_id: selected,
                  });
                  setProposed(res);
                }}
              >
                Propose ops
              </button>
              {proposed?.ops?.map((op: any, i: number) => (
                <div key={i} className="border border-halftone p-2 text-sm">
                  <div className="font-mono text-xs">{op.op}</div>
                  <div>{op.explain_hi}</div>
                  {op.blast_radius && (
                    <div className="text-vermilion text-xs mt-1">Blast: {op.blast_radius}</div>
                  )}
                  <button
                    className="mt-2 text-xs underline text-indigo"
                    onClick={() => api.applyOps([op]).then(() => qc.invalidateQueries({ queryKey: ["page", pageId] }))}
                  >
                    Apply
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === "notes" && (
            <div className="space-y-2">
              {notes.map((n: any) => (
                <div key={n.id} className="border border-halftone p-2 text-sm">
                  <div className="text-xs font-mono text-ink/40">
                    {n.x?.toFixed?.(2)},{n.y?.toFixed?.(2)} · {n.status}
                  </div>
                  <div>{n.body}</div>
                </div>
              ))}
              {!notes.length && <p className="text-ink/45 text-sm">Click Pin note, then the canvas.</p>}
            </div>
          )}
        </div>

        {selectedRegion && tab === "regions" && (
          <div className="border-t border-halftone p-3 space-y-2">
            <label className="block text-xs text-ink/50">Hindi</label>
            <textarea
              className="w-full border border-halftone p-2 text-sm min-h-[80px]"
              value={selectedRegion.target_text || ""}
              onChange={(e) => patch.mutate({ target_text: e.target.value })}
            />
            <div className="flex gap-2 text-xs">
              <button className="border border-halftone px-2 py-1" onClick={() => patch.mutate({ locked: true })}>
                Lock 🔒
              </button>
              <span className="font-mono text-ink/40 self-center">
                {(selectedRegion.target_text || "").length} chars
              </span>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
