import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DialectCode } from "@/domain/codes";

function stripQuotes(v: string): string {
  const t = v.trim();
  if (
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2) ||
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2)
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = stripQuotes(line.slice(eq + 1));
    out[k] = v;
  }
  return out;
}

function pick(...vals: Array<string | undefined>): string {
  for (const v of vals) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function loadDotenvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const parsed = parseDotenv(fs.readFileSync(envPath, "utf8"));
  // Last assignment in .env wins (dashboard dumps often repeat keys).
  // Skip empty values so they cannot wipe a non-empty process env / earlier key.
  for (const [k, v] of Object.entries(parsed)) {
    if (v) process.env[k] = v;
    else if (process.env[k] === undefined) process.env[k] = v;
  }
}

function materializeGcpSa(): string {
  const dest = path.resolve(
    process.cwd(),
    pick(process.env.GOOGLE_APPLICATION_CREDENTIALS, "./secrets/gcp-sa.json") ||
      "./secrets/gcp-sa.json",
  );
  const raw = pick(process.env.GCP_SA_KEY_JSON, process.env.GOOGLE_SA_KEY_JSON);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.type === "service_account") {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(parsed, null, 2), { mode: 0o600 });
      }
    } catch {
      /* keep existing file if present */
    }
  }
  if (fs.existsSync(dest)) return dest;
  return pick(process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

loadDotenvFile();

const credsPath = materializeGcpSa();
if (credsPath) process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;

const snapshotExplicit = pick(process.env.SNAPSHOT_MODE);
const vertexProject = pick(process.env.VERTEX_PROJECT, process.env.GCP_PROJECT_ID);
const vertexLocation = pick(
  process.env.VERTEX_GEMINI_LOCATION,
  process.env.VERTEX_LOCATION,
  "global",
);
const elevenKey = pick(process.env.ELEVENLABS_API_KEY);
const antryamiKey = pick(process.env.ANTRYAMI_API_KEY, process.env.ANTARYAMI_API_KEY);
const antryamiUrl = pick(
  process.env.ANTRYAMI_BASE_URL,
  process.env.ANTRYAMI_API_URL,
  process.env.ANTARYAMI_BASE_URL,
  process.env.ANTARYAMI_API_URL,
  antryamiKey ? "https://antaryami.stage.in/api/v1" : "",
);
const clickhouseUrl = pick(process.env.CLICKHOUSE_URL);
const clickhousePass = pick(process.env.CLICKHOUSE_PASSWORD, process.env.CLICKHOUSE_PASS);

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SNAPSHOT_MODE: z.boolean(),
  STORAGE_ROOT: z.string().default("./public/storage"),
  VERTEX_PROJECT: z.string().default(""),
  VERTEX_LOCATION: z.string().default("global"),
  VERTEX_PLAN_MODEL: z.string().default(""),
  VERTEX_JUDGE_MODEL: z.string().default(""),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().default(""),
  ELEVENLABS_API_KEY: z.string().default(""),
  ELEVENLABS_VOICE_ID: z.string().default(""),
  ELEVENLABS_MODEL: z.string().default("eleven_v3"),
  ANTRYAMI_BASE_URL: z.string().default(""),
  ANTRYAMI_API_KEY: z.string().default(""),
  CLICKHOUSE_URL: z.string().default(""),
  CLICKHOUSE_USER: z.string().default(""),
  CLICKHOUSE_PASSWORD: z.string().default(""),
  CLICKHOUSE_DB: z.string().default(""),
});

export const env = Env.parse({
  DATABASE_URL: pick(process.env.DATABASE_URL),
  REDIS_URL: pick(process.env.REDIS_URL),
  SNAPSHOT_MODE: snapshotExplicit === "true" || snapshotExplicit === "1",
  STORAGE_ROOT: pick(process.env.STORAGE_ROOT, "./public/storage"),
  VERTEX_PROJECT: vertexProject,
  VERTEX_LOCATION: vertexLocation,
  VERTEX_PLAN_MODEL: pick(process.env.VERTEX_PLAN_MODEL),
  VERTEX_JUDGE_MODEL: pick(process.env.VERTEX_JUDGE_MODEL),
  GOOGLE_APPLICATION_CREDENTIALS: credsPath,
  ELEVENLABS_API_KEY: elevenKey,
  ELEVENLABS_VOICE_ID: pick(process.env.ELEVENLABS_VOICE_ID),
  ELEVENLABS_MODEL: pick(process.env.ELEVENLABS_MODEL, "eleven_v3"),
  ANTRYAMI_BASE_URL: antryamiUrl,
  ANTRYAMI_API_KEY: antryamiKey,
  CLICKHOUSE_URL: clickhouseUrl,
  CLICKHOUSE_USER: pick(process.env.CLICKHOUSE_USER),
  CLICKHOUSE_PASSWORD: clickhousePass,
  CLICKHOUSE_DB: pick(process.env.CLICKHOUSE_DB),
});

export const providers = {
  vertex: !env.SNAPSHOT_MODE && Boolean(env.VERTEX_PROJECT && env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(env.GOOGLE_APPLICATION_CREDENTIALS)),
  elevenlabs: !env.SNAPSHOT_MODE && Boolean(env.ELEVENLABS_API_KEY),
  antryami: !env.SNAPSHOT_MODE && Boolean(env.ANTRYAMI_BASE_URL && env.ANTRYAMI_API_KEY),
  clickhouse: !env.SNAPSHOT_MODE && Boolean(env.CLICKHOUSE_URL && env.CLICKHOUSE_USER),
};

export const ALL_DIALECTS = DialectCode.options;
