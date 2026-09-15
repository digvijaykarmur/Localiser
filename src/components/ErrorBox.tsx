import type { ApiError } from "./lib/api";

/** Errors name the thing that failed and the fix (§13). */
export function ErrorBox({ error, className = "" }: { error: ApiError | Error | string | null | undefined; className?: string }) {
  if (!error) return null;
  const e: ApiError = typeof error === "string" ? { code: "ERROR", message: error } : "code" in error ? error : { code: "ERROR", message: error.message };
  const failed = Array.isArray(e.detail?.failed) ? (e.detail!.failed as string[]) : Array.isArray(e.detail?.problems) ? (e.detail!.problems as string[]) : null;
  return (
    <div className={`border border-rejected/60 bg-rejected/10 rounded-md p-3 text-[13px] ${className}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-rejected font-medium">{e.code}</span>
        <span className="text-ink">{e.message}</span>
      </div>
      {failed && (
        <ul className="mt-2 space-y-0.5 text-muted list-disc pl-4">
          {failed.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {e.recovery && <div className="mt-2 text-muted">→ {e.recovery}</div>}
      {typeof e.detail?.raw_storage_key === "string" && (
        <a className="mt-1 inline-block text-accent" href={`/media/${e.detail.raw_storage_key}`} target="_blank" rel="noreferrer">
          Open raw model output
        </a>
      )}
    </div>
  );
}
