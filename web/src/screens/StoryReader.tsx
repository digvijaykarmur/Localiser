import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export default function StoryReader() {
  const { seriesId, ch } = useParams();
  const chapterId = `${seriesId}/${ch}`;
  const story = useQuery({ queryKey: ["story", chapterId], queryFn: () => api.getStory(chapterId) });
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);

  const md = story.data?.markdown as string | null;
  const meta = story.data?.meta ?? {};
  const target = 2600;
  const min = 2000;
  const words = meta.wordcount ?? 0;

  async function regen() {
    setBusy(true);
    try {
      await api.regenStory(chapterId, hint || undefined);
      story.refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-display text-xl font-bold">Story — {ch}</h1>
        <div className="flex-1 h-1.5 bg-halftone/40 rounded overflow-hidden" title={`${words} / ${min} min`}>
          <div
            className={`h-full ${words >= min ? "bg-sage" : "bg-vermilion"}`}
            style={{ width: `${Math.min(100, (words / target) * 100)}%` }}
          />
        </div>
        <span className="font-mono text-xs text-ink/60">{words}w</span>
      </div>

      {meta.drift?.length > 0 && (
        <div className="border border-vermilion/40 bg-vermilion/5 rounded p-3 mb-4 text-sm">
          <b className="text-vermilion">story_dialogue_drift</b> — ये लाइनें images से मेल नहीं खातीं:
          <ul className="mt-1 font-deva">
            {meta.drift.slice(0, 5).map((d: any, i: number) => (
              <li key={i}>• {d.line}</li>
            ))}
          </ul>
        </div>
      )}

      {md ? (
        <article
          className="font-deva bg-white border border-halftone rounded-lg p-8"
          style={{ maxWidth: "68ch", lineHeight: 1.85, fontSize: 19 }}
        >
          {md.split("\n").map((line, i) =>
            line.startsWith("# ") ? (
              <h1 key={i} className="font-bold text-2xl mb-6">{line.slice(2)}</h1>
            ) : line.trim() === "◆" ? (
              <div key={i} className="text-center my-6 text-halftone">◆</div>
            ) : (
              <p key={i} className="mb-4">{line}</p>
            )
          )}
        </article>
      ) : (
        <div className="halftone-edge border border-halftone rounded-lg p-16 text-center text-ink/50">
          No story yet — run the Story stage from the Chapter Board.
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <input
          className="flex-1 px-2 py-1.5 border border-halftone rounded font-deva text-sm"
          placeholder="Regenerate note — जैसे: दूसरा दृश्य और भावुक करो"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
        />
        <button className="btn btn-primary" disabled={busy} onClick={regen}>
          {busy ? "Regenerating…" : "Regenerate with note"}
        </button>
      </div>
    </div>
  );
}
