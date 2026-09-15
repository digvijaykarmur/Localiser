import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PromoError, RawScene } from "@/domain";
import type { ClickHousePort, PerformanceRow } from "../ports";

const QUERY_DIR = path.resolve(process.cwd(), "src/providers/clickhouse/queries");

/** Parameterised HTTP interface. SQL lives in *.sql files; parameters go through `param_*`. */
export class RealClickHouse implements ClickHousePort {
  readonly mode = "real" as const;
  constructor(
    private readonly url: string,
    private readonly user?: string,
    private readonly password?: string,
  ) {}

  private sqlFile(name: string): string {
    return fs.readFileSync(path.join(QUERY_DIR, `${name}.sql`), "utf8");
  }

  private async query<T>(name: string, params: Record<string, string | number>, row: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T[]> {
    const q = new URLSearchParams({ query: `${this.sqlFile(name)} FORMAT JSONEachRow`, default_format: "JSONEachRow" });
    for (const [k, v] of Object.entries(params)) q.set(`param_${k}`, String(v));
    const headers: Record<string, string> = {};
    if (this.user) headers["X-ClickHouse-User"] = this.user;
    if (this.password) headers["X-ClickHouse-Key"] = this.password;
    const res = await fetch(`${this.url.replace(/\/$/, "")}/?${q}`, { headers }).catch((e) => {
      throw new PromoError("PROVIDER_UNAVAILABLE", `ClickHouse unreachable: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
    });
    if (!res.ok) throw new PromoError("PROVIDER_UNAVAILABLE", `ClickHouse ${name}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const text = await res.text();
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => row.parse(JSON.parse(l)));
  }

  async getScenes(titleId: string): Promise<RawScene[]> {
    const rows = await this.query("scenes", { title_id: titleId }, z.object({ seq: z.coerce.number(), start_ms: z.coerce.number(), end_ms: z.coerce.number() }));
    return rows.map((r) => RawScene.parse({ title_id: titleId, ...r }));
  }

  async getPromoPerformance(sinceDays: number): Promise<PerformanceRow[]> {
    const Row: z.ZodType<PerformanceRow, z.ZodTypeDef, unknown> = z.object({
      promo_id: z.string(),
      published_at: z
        .string()
        .nullable()
        .optional()
        .transform((v) => v ?? null),
      impressions: z.coerce.number(),
      view_3s: z.coerce.number(),
      views_complete: z.coerce.number(),
      clicks: z.coerce.number(),
    });
    return this.query("promo_performance", { since_days: sinceDays }, Row);
  }

  async ping() {
    try {
      const headers: Record<string, string> = {};
      if (this.user) headers["X-ClickHouse-User"] = this.user;
      if (this.password) headers["X-ClickHouse-Key"] = this.password;
      const res = await fetch(`${this.url.replace(/\/$/, "")}/ping`, { headers });
      return res.ok ? { ok: true } : { ok: false, error: `ClickHouse /ping returned ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
