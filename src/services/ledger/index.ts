import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ledger, outcomes, goldenSet } from "@/db/schema";
import {
  LedgerRow,
  MetricsSummary,
  PppTier,
  type EditorVerdict,
  type ReasonCode,
} from "@/domain";
import { nowIso } from "@/lib/hash";
import { providerCanary } from "@/db/schema";

export async function upsertLedger(row: LedgerRow) {
  await db
    .insert(ledger)
    .values({
      promoId: row.promo_id,
      recipeId: row.recipe_id,
      titleId: row.title_id,
      format: row.format,
      dialect: row.dialect,
      ratio: row.ratio,
      createdAt: new Date(row.created_at),
      payload: row,
    })
    .onConflictDoUpdate({
      target: ledger.promoId,
      set: { payload: row },
    });
}

export async function applyReview(args: {
  recipeId: string;
  verdict: EditorVerdict;
  reason_codes: ReasonCode[];
  edit_minutes: number;
}) {
  const rows = await db.select().from(ledger).where(eq(ledger.recipeId, args.recipeId));
  for (const r of rows) {
    const payload = LedgerRow.parse(r.payload);
    const next = LedgerRow.parse({
      ...payload,
      editor_verdict: args.verdict,
      editor_reason_codes: args.reason_codes,
      editor_edit_minutes: args.edit_minutes,
      published_at: args.verdict === "approved" ? nowIso() : payload.published_at,
    });
    await db.update(ledger).set({ payload: next }).where(eq(ledger.promoId, r.promoId));
  }
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const rank = (arr: number[]) => {
    const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = Array(arr.length).fill(0);
    for (let i = 0; i < sorted.length; i++) ranks[sorted[i]!.i] = i + 1;
    return ranks as number[];
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (rx[i]! - ry[i]!) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function computePppTier(args: {
  produced: number;
  approvalRate: number | null;
  medianEdit: number | null;
  r01r02Last30: number;
}): PppTier {
  const { produced, approvalRate, medianEdit, r01r02Last30 } = args;
  if (
    produced >= 50 &&
    (approvalRate ?? 0) >= 0.8 &&
    (medianEdit ?? 99) <= 4 &&
    r01r02Last30 === 0
  ) {
    return "PRODUCTION";
  }
  if (produced >= 20 && (approvalRate ?? 0) >= 0.6 && (medianEdit ?? 99) <= 10) {
    return "PILOT";
  }
  return "PROVE";
}

export async function metricsSummary(): Promise<MetricsSummary> {
  const rows = await db.select().from(ledger);
  const parsed = rows.map((r) => LedgerRow.parse(r.payload));
  const outcomeRows = await db.select().from(outcomes);
  const byPromo = new Map(outcomeRows.map((o) => [o.promoId, o]));

  const keys = new Map<string, LedgerRow[]>();
  for (const p of parsed) {
    const k = `${p.format}|${p.dialect}`;
    const arr = keys.get(k) ?? [];
    arr.push(p);
    keys.set(k, arr);
  }

  const golden = await db.select().from(goldenSet);
  const pairs = [...keys.entries()].map(([k, list]) => {
    const [format, dialect] = k.split("|") as [string, LedgerRow["dialect"]];
    const produced = list.length;
    const reviewed = list.filter((x) => x.editor_verdict);
    const approved = reviewed.filter((x) => x.editor_verdict === "approved");
    const approval_rate = reviewed.length ? approved.length / reviewed.length : null;
    const edits = reviewed.map((x) => x.editor_edit_minutes).filter((n): n is number => n != null);
    const costs = approved.map((x) => x.cost_inr);
    const histMap = new Map<string, number>();
    for (const r of list) {
      for (const c of r.editor_reason_codes) histMap.set(c, (histMap.get(c) ?? 0) + 1);
    }
    const reason_histogram = [...histMap.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const last30 = Date.now() - 30 * 86400000;
    const r01r02Last30 = list.filter((x) => {
      const t = new Date(x.created_at).getTime();
      if (t < last30) return false;
      return x.editor_reason_codes.some((c) => c === "R01_WRONG_CLAIM" || c === "R02_SPOILER");
    }).length;
    const median_edit_minutes = median(edits);
    const g = golden.filter((g) => g.dialect === dialect);
    const corr = spearman(
      g.map((x) => x.judgeA8 ?? 0),
      g.map((x) => x.editorOverall),
    );
    return {
      format,
      dialect,
      produced,
      approval_rate,
      median_edit_minutes,
      median_cost_approved_inr: median(costs),
      reason_histogram,
      judge_editor_spearman: corr,
      ppp_tier: computePppTier({
        produced,
        approvalRate: approval_rate,
        medianEdit: median_edit_minutes,
        r01r02Last30,
      }),
    };
  });

  for (const p of parsed) {
    const o = byPromo.get(p.promo_id);
    if (!o) continue;
    p.impressions = o.impressions;
    p.view_rate_3s = o.view3s;
    p.completion_rate = o.viewsComplete;
    p.ctr_to_title = o.impressions ? o.clicks / o.impressions : null;
  }

  const canaries = await db.select().from(providerCanary);
  return MetricsSummary.parse({
    pairs,
    providers: canaries.map((c) => ({
      provider: c.provider,
      model: c.model,
      last_ok_at: c.lastOkAt ? c.lastOkAt.toISOString() : null,
      last_error: c.lastError,
    })),
  });
}
