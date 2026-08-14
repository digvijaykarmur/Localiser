import { Link, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export default function Shell() {
  const { seriesId } = useParams();
  const cost = useQuery({ queryKey: ["cost"], queryFn: api.cost, refetchInterval: 20000 });
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-4 px-4 py-2 border-b border-halftone bg-white/70">
        <Link to="/" className="font-display font-bold text-lg tracking-tight">
          Localiser <span className="text-halftone">/</span>{" "}
          <span className="font-deva text-indigo">चित्रकथा</span>
        </Link>
        {seriesId && (
          <nav className="flex gap-3 text-sm">
            <Link className="hover:text-indigo" to={`/series/${seriesId}/chapters`}>
              Chapters
            </Link>
            <Link className="hover:text-indigo" to={`/series/${seriesId}/bible`}>
              Bible
            </Link>
            <Link className="hover:text-indigo" to={`/series/${seriesId}/export`}>
              Export
            </Link>
          </nav>
        )}
        <div className="ml-auto font-mono text-xs text-ink/60">
          {cost.data ? `${cost.data.calls} calls · ~$${cost.data.estimated_usd}` : ""}
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
