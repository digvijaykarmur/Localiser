import { z } from "zod";
import { DialectCode } from "@/domain/codes";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SNAPSHOT_MODE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  STORAGE_ROOT: z.string().default("./data/storage"),
  VERTEX_PROJECT: z.string().optional().default(""),
  VERTEX_LOCATION: z.string().optional().default("us-central1"),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional().default(""),
  ELEVENLABS_API_KEY: z.string().optional().default(""),
  ANTRYAMI_BASE_URL: z.string().optional().default(""),
  ANTRYAMI_API_KEY: z.string().optional().default(""),
  CLICKHOUSE_URL: z.string().optional().default(""),
  CLICKHOUSE_USER: z.string().optional().default(""),
  CLICKHOUSE_PASSWORD: z.string().optional().default(""),
});

function loadEnv() {
  if (!process.env.DATABASE_URL) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      const path = require("node:path") as typeof import("node:path");
      const envPath = path.resolve(process.cwd(), ".env");
      if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq < 0) continue;
          const k = trimmed.slice(0, eq);
          const v = trimmed.slice(eq + 1);
          if (process.env[k] === undefined) process.env[k] = v;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return Env.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    SNAPSHOT_MODE: process.env.SNAPSHOT_MODE,
    STORAGE_ROOT: process.env.STORAGE_ROOT,
    VERTEX_PROJECT: process.env.VERTEX_PROJECT,
    VERTEX_LOCATION: process.env.VERTEX_LOCATION,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    ANTRYAMI_BASE_URL: process.env.ANTRYAMI_BASE_URL,
    ANTRYAMI_API_KEY: process.env.ANTRYAMI_API_KEY,
    CLICKHOUSE_URL: process.env.CLICKHOUSE_URL,
    CLICKHOUSE_USER: process.env.CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD,
  });
}

export const env = loadEnv();

export const ALL_DIALECTS = DialectCode.options;
