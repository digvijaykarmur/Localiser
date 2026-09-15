import fs from "node:fs";
import path from "node:path";

/**
 * The hand-made baseline (§1.4) lives in docs/BASELINE.md. The dashboard reads the median
 * edit-minutes figure from a line of the form `baseline_median_edit_minutes: 42`.
 */
export function readBaseline(): number | null {
  const p = path.resolve(process.cwd(), "docs/BASELINE.md");
  if (!fs.existsSync(p)) return null;
  const m = /baseline_median_edit_minutes:\s*([0-9.]+)/.exec(fs.readFileSync(p, "utf8"));
  return m ? Number(m[1]) : null;
}
