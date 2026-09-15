import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/config/env";

declare global {
  // eslint-disable-next-line no-var
  var __promoSql: ReturnType<typeof postgres> | undefined;
}

const sql = globalThis.__promoSql ?? postgres(env.DATABASE_URL, { max: 10, idle_timeout: 30, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") globalThis.__promoSql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export { sql, schema };
export type { AssetProvenance } from "./schema";

export async function pingDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    await sql`select 1`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
