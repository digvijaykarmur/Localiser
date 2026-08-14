import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { api, OpCard, RegionT } from "../api";

type ViewMode = "original" | "cleaned" | "composite" | "diff";
type Tab = "Regions" | "Chat" | "Notes";

const STATUS_COLOR: Record<string, string> = {
  approved: "#7C8B6F",
  flagged: "#C8372A",
  skipped: "#9b968c",
};

export default function PageReview() {
  const { seriesId, ch, idx } = useParams();
  const pageId = `${seriesId}/${ch}/${idx}`;
  const qc = useQueryClient();
  const page = useQuery({ queryKey: ["page", pageId], queryFn: () => api.getPage(pageId) });
  const chapters = useQuery({
    queryKey: ["chapters", seriesId],
    queryFn: () => api.listChapters(seriesId!),
  });

  const [view, setView] = useState<ViewMode>("composite");
  const [tab, setTab] = useState<Tab>("Regions");
  const [selected, setSelected] = useState<string | null>(null);
  const [slider, setSlider] = useState(0.5);
  const [sliderOn, setSliderOn] = useState(true);
  const [pinMode, setPinMode] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const regions = page.data?.regions ?? [];
  const v = page.data?.version ?? 0;
  const W = page.data?.width ?? 1;
  const H = page.data?.height ?? 1;

  const chapter = chapters.data?.find((c) => c.id === `${seriesId}/${ch}`);
  const pageCount = chapter?.page_count ?? 0;

  const approve = useMutation({
    mutationFn: () => api.approvePage(pageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["page", pageId] }),
  });

  // keyboard: J/K region nav, A approve region, Shift+A approve page, F flag, Z toggle view
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA")
        return;
      const ordered = regions;
      const i = ordered.findIndex((r) => r.id === selected);
      if (e.key === "j" || e.key === "J") setSelected(ordered[Math.min(i + 1, ordered.length - 1)]?.id ?? null);
      if (e.key === "k" || e.key === "K") setSelected(ordered[Math.max(i - 1, 0)]?.id ?? null);
      if (e.key === "z" || e.key === "Z") setView((vw) => (vw === "original" ? "composite" : "original"));
      if (e.key === "A" && e.shiftKey) approve.mutate();
    },
    [regions, selected, approve]
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  return (
    <div className="flex h-[calc(100vh-45px)]">
      {/* left rail: page filmstrip */}
      <div className="w-20 border-r border-halftone bg-white/50 overflow-y-auto p-1">
        <label className="block text-[10px] px-1 mb-1">
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
          />{" "}
          flagged
        </label>
        {Array.from({ length: pageCount }, (_, i) => String(i + 1).padStart(3, "0")).map((pidx) => (
          <Link
            key={pidx}
            to={`/series/${seriesId}/${ch}/pages/${pidx}`}
            className={`block mb-1 border rounded overflow-hidden ${
              pidx === idx ? "border-indigo" : "border-halftone"
            }`}
          >
            <img
              src={api.pageImageUrl(`${seriesId}/${ch}/${pidx}`, "original")}
              className="w-full"
              loading="lazy"
              alt=""
            />
            <div className="text-center font-mono text-[9px]">{pidx}</div>
          </Link>
        ))}
      </div>

      {/* center canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-halftone bg-white/60">
          {(["original", "cleaned", "composite", "diff"] as ViewMode[]).map((m) => (
            <button
              key={m}
              className={`text-sm px-2 py-0.5 rounded ${view === m ? "bg-indigo text-white" : "hover:bg-halftone/40"}`}
              onClick={() => setView(m)}
            >
              {m === "composite" ? "Final" : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
          <label className="text-xs ml-2">
            <input type="checkbox" checked={sliderOn} onChange={(e) => setSliderOn(e.target.checked)} />{" "}
            registration slider
          </label>
          <button
            className={`btn text-xs ml-2 ${pinMode ? "btn-primary" : ""}`}
            onClick={() => setPinMode(!pinMode)}
          >
            📍 pin
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="badge bg-halftone/40">{page.data?.state}</span>
            <button className="btn text-xs" onClick={() => api.rebuildPage(pageId).then(() => page.refetch())}>
              Rebuild
            </button>
            <button className="btn btn-primary text-xs" onClick={() => approve.mutate()}>
              Approve page (⇧A)
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-halftone/20">
          <TransformWrapper minScale={0.1} maxScale={8} limitToBounds={false} centerOnInit>
            <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
              <Canvas
                pageId={pageId}
                view={view}
                v={v}
                W={W}
                H={H}
                regions={flaggedOnly ? regions.filter((r) => r.status === "flagged") : regions}
                selected={selected}
                onSelect={setSelected}
                slider={sliderOn ? slider : 1}
                setSlider={setSlider}
                sliderOn={sliderOn}
                pinMode={pinMode}
                onPin={async (x, y) => {
                  const body = prompt("Note (Hindi/English दोनों चलेंगे):");
                  if (body) {
                    await api.createNote({ page_id: pageId, x, y, body });
                    setPinMode(false);
                    qc.invalidateQueries({ queryKey: ["notes", pageId] });
                    setTab("Notes");
                  }
                }}
              />
            </TransformComponent>
          </TransformWrapper>
        </div>
      </div>

      {/* right rail */}
      <div className="w-96 border-l border-halftone bg-white/60 flex flex-col">
        <div className="flex border-b border-halftone">
          {(["Regions", "Chat", "Notes"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-sm ${tab === t ? "border-b-2 border-indigo font-medium" : "text-ink/60"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {tab === "Regions" && (
            <RegionsList
              regions={regions}
              selected={selected}
              onSelect={setSelected}
              pageId={pageId}
              onChanged={() => page.refetch()}
            />
          )}
          {tab === "Chat" && <ChatRail seriesId={seriesId!} pageId={pageId} selected={selected} onApplied={() => page.refetch()} />}
          {tab === "Notes" && <NotesRail pageId={pageId} onApplied={() => page.refetch()} />}
        </div>
      </div>
    </div>
  );
}

/** The Registration Slider comparator + region overlays (§3.2 signature element). */
function Canvas(props: {
  pageId: string;
  view: ViewMode;
  v: number;
  W: number;
  H: number;
  regions: RegionT[];
  selected: string | null;
  onSelect: (id: string) => void;
  slider: number;
  setSlider: (v: number) => void;
  sliderOn: boolean;
  pinMode: boolean;
  onPin: (x: number, y: number) => void;
}) {
  const { pageId, view, v, W, H, regions, selected, onSelect, slider, setSlider, sliderOn, pinMode, onPin } = props;
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const topUrl = api.pageImageUrl(pageId, view === "original" ? "original" : view, v);
  const showSlider = sliderOn && view !== "original";

  return (
    <div
      ref={ref}
      className="relative select-none"
      style={{ width: W, height: H }}
      onClick={(e) => {
        if (!pinMode || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        onPin((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }}
      onPointerMove={(e) => {
        if (!dragging.current || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        setSlider(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
      }}
      onPointerUp={() => (dragging.current = false)}
    >
      {/* original underneath */}
      <img src={api.pageImageUrl(pageId, "original", v)} width={W} height={H} className="absolute inset-0" alt="" draggable={false} />
      {/* processed on top, revealed by the slider */}
      <img
        src={topUrl}
        width={W}
        height={H}
        className="absolute inset-0"
        style={showSlider ? { clipPath: `inset(0 ${100 - slider * 100}% 0 0)` } : undefined}
        alt=""
        draggable={false}
      />
      {/* halftone transition edge + crosshair handle */}
      {showSlider && (
        <>
          <div
            className="absolute top-0 bottom-0 halftone-edge"
            style={{ left: `calc(${slider * 100}% - 3px)`, width: 6, opacity: 0.9 }}
          />
          <div
            className="absolute"
            style={{ left: `calc(${slider * 100}% - 17px)`, top: "50%", transform: "translateY(-50%)" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              dragging.current = true;
            }}
          >
            <div className="reg-handle">
              <span className="reg-tick border-t border-l" style={{ top: -6, left: -6 }} />
              <span className="reg-tick border-t border-r" style={{ top: -6, right: -6 }} />
              <span className="reg-tick border-b border-l" style={{ bottom: -6, left: -6 }} />
              <span className="reg-tick border-b border-r" style={{ bottom: -6, right: -6 }} />
            </div>
          </div>
        </>
      )}
      {/* region overlays */}
      {regions.map((r) => {
        const [x, y, w, h] = r.bbox;
        const color =
          STATUS_COLOR[r.status] ??
          (r.confidence != null && r.confidence < 0.7 ? "#d99a26" : "#2B3A5B");
        return (
          <div
            key={r.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(r.id);
            }}
            className="absolute cursor-pointer transition-all duration-[180ms]"
            style={{
              left: x,
              top: y,
              width: w,
              height: h,
              border: `2px solid ${color}`,
              boxShadow: selected === r.id ? `0 0 0 3px ${color}55` : undefined,
              background: selected === r.id ? `${color}11` : "transparent",
            }}
            title={`${r.id.split("/").pop()} · ${r.kind} · ${r.status}`}
          />
        );
      })}
    </div>
  );
}

function RegionsList({
  regions,
  selected,
  onSelect,
  pageId,
  onChanged,
}: {
  regions: RegionT[];
  selected: string | null;
  onSelect: (id: string) => void;
  pageId: string;
  onChanged: () => void;
}) {
  return (
    <div className="divide-y divide-halftone/60">
      {regions.map((r) => (
        <RegionRow key={r.id} r={r} selected={selected === r.id} onSelect={() => onSelect(r.id)} onChanged={onChanged} />
      ))}
      {regions.length === 0 && <div className="p-4 text-sm text-ink/50">No regions — run Analyze.</div>}
    </div>
  );
}

const KIND_ICON: Record<string, string> = {
  dialogue: "💬",
  thought: "💭",
  narration: "▭",
  sfx: "✴",
  sign: "🪧",
  ui_window: "🖥",
  credit: "©",
  unknown: "?",
};

function RegionRow({
  r,
  selected,
  onSelect,
  onChanged,
}: {
  r: RegionT;
  selected: boolean;
  onSelect: () => void;
  onChanged: () => void;
}) {
  const [text, setText] = useState(r.target_text ?? "");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(r.target_text ?? ""), [r.target_text]);
  const maxChars = Math.max(20, Math.floor((r.bbox[2] * r.bbox[3]) / 900));

  async function save() {
    setBusy(true);
    try {
      await api.patchRegion(r.id, { target_text: text });
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function regen() {
    setBusy(true);
    try {
      await api.retranslate(r.id, hint || undefined);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`p-2 ${selected ? "bg-indigo/5" : ""}`} onClick={onSelect}>
      <div className="flex items-center gap-1.5 text-xs">
        <span>{KIND_ICON[r.kind] ?? "?"}</span>
        <span className="font-mono text-ink/50">{r.id.split("/").pop()}</span>
        <button
          className="badge bg-halftone/40 hover:bg-indigo/10"
          title="click to change speaker"
          onClick={async (e) => {
            e.stopPropagation();
            const sp = prompt("speaker_id (from the bible, e.g. char_lakshya):", r.speaker_id ?? "");
            if (sp !== null) {
              await api.patchRegion(r.id, { speaker_id: sp });
              onChanged();
            }
          }}
        >
          {r.speaker_id ?? "speaker?"}
        </button>
        <span className={`badge ml-auto ${r.status === "flagged" ? "bg-vermilion/10 text-vermilion" : r.status === "approved" ? "bg-sage/20 text-sage" : "bg-halftone/40"}`}>
          {r.status}
        </span>
      </div>
      {r.src_text && <div className="text-[11px] text-ink/50 mt-1 line-clamp-2">{r.src_text}</div>}
      {r.src_script === "deva" ? (
        <div className="text-[11px] text-sage mt-1">पहले से हिंदी — untouched (NN-6)</div>
      ) : (
        <>
          <div className="flex items-start gap-1 mt-1">
            <textarea
              className="flex-1 px-1.5 py-1 border border-halftone rounded font-deva text-sm bg-white"
              rows={2}
              value={text}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="text-xs"
              title={r.target_locked ? "locked — never auto-overwritten" : "unlocked"}
              onClick={async (e) => {
                e.stopPropagation();
                await api.patchRegion(r.id, { locked: !r.target_locked });
                onChanged();
              }}
            >
              {r.target_locked ? "🔒" : "🔓"}
            </button>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <span className={`font-mono text-[10px] ${text.length > maxChars ? "text-vermilion" : "text-ink/40"}`}>
              {text.length}/{maxChars}
            </span>
            <input
              className="flex-1 px-1 py-0.5 text-[11px] border border-halftone rounded"
              placeholder="regenerate hint…"
              value={hint}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setHint(e.target.value)}
            />
            <button className="btn text-[11px] px-1.5 py-0.5" disabled={busy} onClick={(e) => { e.stopPropagation(); regen(); }}>
              Regenerate
            </button>
            <button className="btn btn-primary text-[11px] px-1.5 py-0.5" disabled={busy || text === (r.target_text ?? "")} onClick={(e) => { e.stopPropagation(); save(); }}>
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ChatRail({
  seriesId,
  pageId,
  selected,
  onApplied,
}: {
  seriesId: string;
  pageId: string;
  selected: string | null;
  onApplied: () => void;
}) {
  const [scope, setScope] = useState<"region" | "page" | "chapter" | "series">("page");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<OpCard[]>([]);
  const [history, setHistory] = useState<{ who: string; text: string }[]>([]);

  const scopeId =
    scope === "region" ? selected ?? pageId :
    scope === "page" ? pageId :
    scope === "chapter" ? pageId.split("/").slice(0, 2).join("/") : seriesId;

  async function send() {
    if (!msg.trim()) return;
    setBusy(true);
    setHistory((h) => [...h, { who: "you", text: msg }]);
    try {
      const res = await api.chat(scope, scopeId, msg, selected);
      setCards(res.ops ?? []);
      const ask = (res.ops ?? []).find((o) => o.op === "ASK");
      if (ask) setHistory((h) => [...h, { who: "tool", text: String(ask.args?.question ?? "?") }]);
      setMsg("");
    } finally {
      setBusy(false);
    }
  }

  async function apply(card: OpCard) {
    setBusy(true);
    try {
      await api.applyOps(seriesId, [card]);
      setCards((c) => c.filter((x) => x !== card));
      setHistory((h) => [...h, { who: "tool", text: `applied ${card.op}` }]);
      onApplied();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-halftone flex gap-1 text-xs">
        {(["region", "page", "chapter", "series"] as const).map((s) => (
          <button
            key={s}
            className={`px-2 py-0.5 rounded ${scope === s ? "bg-indigo text-white" : "bg-halftone/30"}`}
            onClick={() => setScope(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {history.map((m, i) => (
          <div key={i} className={`text-sm ${m.who === "you" ? "text-right" : ""}`}>
            <span className={`inline-block px-2 py-1 rounded ${m.who === "you" ? "bg-indigo/10" : "bg-halftone/30"} font-deva`}>
              {m.text}
            </span>
          </div>
        ))}
        {cards.filter((c) => c.op !== "ASK").map((card, i) => (
          <div key={i} className="border border-indigo/40 rounded p-2 bg-white text-sm">
            <div className="font-mono text-xs text-indigo">{card.op}</div>
            {card.explain_hi && <div className="font-deva mt-1">{card.explain_hi}</div>}
            {card.needs_confirm && (
              <div className="text-vermilion text-xs mt-1">⚠ blast radius: {card.blast_radius}</div>
            )}
            <pre className="text-[10px] text-ink/50 mt-1 overflow-x-auto">{JSON.stringify(card.args)}</pre>
            <div className="flex gap-2 mt-1">
              <button className="btn btn-primary text-xs" disabled={busy} onClick={() => apply(card)}>
                Apply
              </button>
              <button className="btn text-xs" onClick={() => setCards((c) => c.filter((x) => x !== card))}>
                Cancel
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-halftone flex gap-1">
        <input
          className="flex-1 px-2 py-1.5 border border-halftone rounded text-sm font-deva"
          placeholder='जैसे: "यहाँ ये बदलो — भाषा casual करो"'
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn btn-primary text-sm" disabled={busy} onClick={send}>
          →
        </button>
      </div>
    </div>
  );
}

function NotesRail({ pageId, onApplied }: { pageId: string; onApplied: () => void }) {
  const notes = useQuery({ queryKey: ["notes", pageId], queryFn: () => api.listNotes(pageId) });
  const [busy, setBusy] = useState(false);
  return (
    <div className="p-2 space-y-2">
      <div className="text-xs text-ink/50">Click 📍 pin in the toolbar, then click the page to drop a comment.</div>
      {notes.data?.map((n, i) => (
        <div key={n.id} className="border border-halftone rounded p-2 bg-white text-sm">
          <div className="flex items-center gap-2">
            <span className="badge bg-indigo text-white">{i + 1}</span>
            <span className={`badge ${n.status === "open" ? "bg-halftone/40" : n.status === "applied" ? "bg-sage/20 text-sage" : "bg-vermilion/10 text-vermilion"}`}>
              {n.status}
            </span>
            <span className="font-mono text-[10px] text-ink/40 ml-auto">
              ({(n.x * 100).toFixed(0)}%, {(n.y * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="font-deva mt-1">{n.body}</div>
          {n.status === "open" && (
            <div className="flex gap-2 mt-1">
              <button
                className="btn btn-primary text-xs"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.noteAction(n.id, "apply");
                    notes.refetch();
                    onApplied();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Apply
              </button>
              <button className="btn text-xs" onClick={() => api.noteAction(n.id, "reject").then(() => notes.refetch())}>
                Reject
              </button>
              <button className="btn text-xs" onClick={() => api.noteAction(n.id, "resolve").then(() => notes.refetch())}>
                Resolve
              </button>
            </div>
          )}
        </div>
      ))}
      {notes.data?.length === 0 && <div className="text-sm text-ink/50 p-2">No notes yet.</div>}
    </div>
  );
}
