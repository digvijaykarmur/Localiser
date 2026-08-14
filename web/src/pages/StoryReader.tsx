import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";

export function StoryReader() {
  const { chapterId: raw = "" } = useParams();
  const chapterId = decodeURIComponent(raw);
  const { data } = useQuery({
    queryKey: ["story", chapterId],
    queryFn: () => api.story(chapterId),
  });

  const words = data?.words || data?.meta?.wordcount || 0;
  const min = data?.meta?.min_words || 2000;
  const pct = Math.min(100, Math.round((words / min) * 100));

  return (
    <div className="max-w-[68ch] mx-auto px-5 py-10">
      <div className="mb-6">
        <div className="flex justify-between text-xs font-mono text-ink/50 mb-1">
          <span>
            {words} / {min} words
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-1 bg-halftone">
          <div className="h-1 bg-sage" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <article
        className="prose-hi whitespace-pre-wrap text-[19px] leading-[1.85]"
        style={{ fontFamily: '"Mukta", "Inter Tight", sans-serif' }}
      >
        {data?.markdown || "No story yet — run the story stage after locking the bible."}
      </article>
    </div>
  );
}
