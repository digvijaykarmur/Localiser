import { z } from "zod";
import path from "node:path";
import fs from "node:fs";

// Load .env once for workers/scripts (Next.js loads it itself).
function loadDotEnv() {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.replace(/(^|\s+)#.*$/, "").trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("postgres://promo:promo@localhost:5432/promo"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  VERTEX_PROJECT: z.string().optional(),
  VERTEX_LOCATION: z.string().default("asia-south1"),
  GEMINI_API_KEY: z.string().optional(),

  ELEVENLABS_API_KEY: z.string().optional(),

  ANTRYAMI_BASE_URL: z.string().optional(),
  ANTRYAMI_TOKEN: z.string().optional(),
  CLICKHOUSE_URL: z.string().optional(),
  CLICKHOUSE_USER: z.string().optional(),
  CLICKHOUSE_PASSWORD: z.string().optional(),

  STORAGE_DRIVER: z.enum(["fs", "gcs"]).default("fs"),
  STORAGE_ROOT: z.string().default("./.data"),
  GCS_BUCKET: z.string().optional(),

  SNAPSHOT_MODE: bool,
  INR_PER_USD: z.coerce.number().default(88),

  WORKER_MEDIA_CONCURRENCY: z.coerce.number().optional(),
  WORKER_PROVIDER_CONCURRENCY: z.coerce.number().default(4),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

function clean(v: string | undefined) {
  return v === undefined || v.trim() === "" ? undefined : v;
}

const raw: Record<string, string | undefined> = {};
for (const k of Object.keys(EnvSchema.shape)) raw[k] = clean(process.env[k]);
export const env: Env = EnvSchema.parse(raw);

/** Per-provider mode: real when credentials exist, snapshot when SNAPSHOT_MODE or missing. */
export type ProviderMode = "real" | "snapshot";

export function providerModes(): Record<"vertex" | "elevenlabs" | "antryami" | "clickhouse", ProviderMode> {
  const snap = env.SNAPSHOT_MODE;
  return {
    vertex: !snap && (env.GEMINI_API_KEY || (env.VERTEX_PROJECT && env.GOOGLE_APPLICATION_CREDENTIALS)) ? "real" : "snapshot",
    elevenlabs: !snap && env.ELEVENLABS_API_KEY ? "real" : "snapshot",
    antryami: !snap && env.ANTRYAMI_BASE_URL ? "real" : "snapshot",
    clickhouse: !snap && env.CLICKHOUSE_URL ? "real" : "snapshot",
  };
}

export const STORAGE_ROOT_ABS = path.resolve(process.cwd(), env.STORAGE_ROOT);
export const SNAPSHOT_DIR = path.resolve(process.cwd(), "src/data/snapshots");
export const DATA_DIR = path.resolve(process.cwd(), "src/data");
