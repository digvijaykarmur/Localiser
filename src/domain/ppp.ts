import type { PPPTier, Verdict } from "./primitives";
import type { ReasonCode } from "./ledger";

export interface PPPInput {
  promos: number;
  approval_rate: number; // 0..1, approved / reviewed
  median_edit_minutes: number | null;
  recent_r01_r02: number; // count of R01/R02 in the last 30 reviewed promos
}

/** PPP gate (§3.9, §33). Computed, never hand-set. */
export function computeTier(i: PPPInput): PPPTier {
  if (
    i.promos >= 50 &&
    i.approval_rate >= 0.8 &&
    i.median_edit_minutes !== null &&
    i.median_edit_minutes <= 4 &&
    i.recent_r01_r02 === 0
  )
    return "PRODUCTION";
  if (i.promos >= 20 && i.approval_rate >= 0.6 && i.median_edit_minutes !== null && i.median_edit_minutes <= 10) return "PILOT";
  return "PROVE";
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Verdict → ordinal for correlation (approved best). */
export const VERDICT_ORDINAL: Record<Verdict, number> = { approved: 4, minor_edit: 3, major_edit: 2, rejected: 1 };

/** Edit minutes contributed to the definition of done. Approved = 0, rejected = excluded (null). */
export function editMinutesForVerdict(verdict: Verdict, editMinutes: number | null): number | null {
  if (verdict === "approved") return 0;
  if (verdict === "rejected") return null;
  return editMinutes;
}

function rank(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.v === idx[i]!.v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]!.i] = r;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation (§31.3). Returns null when fewer than 3 pairs or zero variance. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i]! - ma;
    const y = rb[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export const SPOILER_CODES: ReasonCode[] = ["R01_WRONG_CLAIM", "R02_SPOILER"];
