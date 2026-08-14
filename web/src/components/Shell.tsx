import { Link, Outlet, useParams } from "react-router-dom";

export function Shell() {
  const { id } = useParams();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-halftone/80 px-5 py-3 flex items-center justify-between bg-paper/80 backdrop-blur-sm sticky top-0 z-40">
        <Link to="/" className="font-display text-2xl tracking-tight text-ink">
          Localiser
        </Link>
        {id && (
          <nav className="flex gap-4 text-sm font-ui text-indigo">
            <Link to={`/series/${id}/chapters`}>Chapters</Link>
            <Link to={`/series/${id}/bible`}>Bible</Link>
            <Link to={`/series/${id}/export`}>Export</Link>
          </nav>
        )}
        <span className="text-xs text-ink/50 font-mono">workshop · local-first</span>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
