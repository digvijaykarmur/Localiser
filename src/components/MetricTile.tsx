/** One number, tabular numerals, one caption (§28.4). */
export function MetricTile({ label, value, sub, tone = "ink" }: { label: string; value: string; sub?: string; tone?: "ink" | "approved" | "rejected" | "amber" | "muted" }) {
  const colour = { ink: "text-ink", approved: "text-approved", rejected: "text-rejected", amber: "text-amber", muted: "text-muted" }[tone];
  return (
    <div className="panel p-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`num text-2xl font-medium mt-1 ${colour}`}>{value}</div>
      {sub && <div className="text-[12px] text-faint mt-0.5">{sub}</div>}
    </div>
  );
}
