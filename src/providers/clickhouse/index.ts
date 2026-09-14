import fs from "node:fs";
import path from "node:path";
import type { ClickHousePort, PerformanceRow, SceneRow } from "./port";
import { env, providers } from "@/lib/env";

function snap(file: string) {
  return path.resolve(process.cwd(), "data/snapshots/clickhouse", file);
}

export class SnapshotClickHouse implements ClickHousePort {
  async scenesForTitle(titleId: string): Promise<SceneRow[]> {
    const p = snap("scenes.json");
    if (!fs.existsSync(p)) return [];
    const all = JSON.parse(fs.readFileSync(p, "utf8")) as SceneRow[];
    return all.filter((s) => s.title_id === titleId);
  }

  async promoPerformance(): Promise<PerformanceRow[]> {
    const p = snap("performance.json");
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, "utf8")) as PerformanceRow[];
  }
}

export class LiveClickHouse implements ClickHousePort {
  constructor(
    private readonly url: string,
    private readonly auth: { user: string; password: string; database: string },
  ) {}

  private async query<T>(sql: string, params: Record<string, string>): Promise<T[]> {
    let body = sql;
    for (const [k, v] of Object.entries(params)) {
      if (!/^[a-zA-Z0-9_]+$/.test(k)) throw new Error("bad param name");
      body = body.replaceAll(`{${k}:String}`, `'${v.replaceAll("'", "''")}'`);
    }
    const endpoint = new URL(this.url);
    if (this.auth.database) endpoint.searchParams.set("database", this.auth.database);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        authorization:
          "Basic " + Buffer.from(`${this.auth.user}:${this.auth.password}`).toString("base64"),
      },
      body: `${body}\nFORMAT JSON`,
    });
    if (!res.ok) throw new Error(`clickhouse ${res.status}: ${(await res.text()).slice(0, 240)}`);
    const json = (await res.json()) as { data: T[] };
    return json.data;
  }

  async scenesForTitle(titleId: string): Promise<SceneRow[]> {
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), "src/providers/clickhouse/queries/scenes.sql"),
      "utf8",
    );
    return this.query<SceneRow>(sql, { id: titleId });
  }

  async promoPerformance(): Promise<PerformanceRow[]> {
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), "src/providers/clickhouse/queries/performance.sql"),
      "utf8",
    );
    return this.query<PerformanceRow>(sql, {});
  }
}

export function getClickHouse(): ClickHousePort {
  if (!providers.clickhouse) return new SnapshotClickHouse();
  const live = new LiveClickHouse(env.CLICKHOUSE_URL, {
    user: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DB,
  });
  const snap = new SnapshotClickHouse();
  return {
    async scenesForTitle(titleId: string) {
      try {
        return await live.scenesForTitle(titleId);
      } catch {
        return snap.scenesForTitle(titleId);
      }
    },
    async promoPerformance() {
      try {
        return await live.promoPerformance();
      } catch {
        return snap.promoPerformance();
      }
    },
  };
}
