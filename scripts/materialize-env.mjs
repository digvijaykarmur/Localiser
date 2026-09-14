import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(".env");
const raw = readFileSync(envPath, "utf8");
const map = new Map();

for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 0) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  map.set(key, value);
}

const saJson = map.get("GCP_SA_KEY_JSON") ?? "";
mkdirSync("secrets", { recursive: true });
if (saJson.includes("private_key")) {
  writeFileSync("secrets/gcp-sa.json", saJson, { mode: 0o600 });
} else if (!existsSync("secrets/gcp-sa.json")) {
  throw new Error("GCP_SA_KEY_JSON missing and secrets/gcp-sa.json not present");
}

const get = (k, fallback = "") => map.get(k) ?? fallback;
const lines = [
  "# STAGE Promo Engine — local env (gitignored).",
  "# Dashboard aliases are accepted; canonical keys below are what the app reads.",
  "",
  "NODE_ENV=development",
  `DATABASE_URL=${get("DATABASE_URL", "postgres://stage:stage@localhost:5432/stage_promo")}`,
  `REDIS_URL=${get("REDIS_URL", "redis://localhost:6379")}`,
  `NEXT_PUBLIC_APP_URL=${get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")}`,
  "STORAGE_ROOT=./public/storage",
  "SNAPSHOT_MODE=false",
  "",
  "# Vertex / Gemini (dashboard used GCP_PROJECT_ID + GCP_SA_KEY_JSON).",
  `VERTEX_PROJECT=${get("VERTEX_PROJECT") || get("GCP_PROJECT_ID")}`,
  `VERTEX_LOCATION=${get("VERTEX_GEMINI_LOCATION") || get("VERTEX_LOCATION") || "global"}`,
  `VERTEX_PLAN_MODEL=${get("VERTEX_PLAN_MODEL")}`,
  `VERTEX_JUDGE_MODEL=${get("VERTEX_JUDGE_MODEL")}`,
  "GOOGLE_APPLICATION_CREDENTIALS=./secrets/gcp-sa.json",
  `GCP_PROJECT_ID=${get("GCP_PROJECT_ID") || get("VERTEX_PROJECT")}`,
  `VERTEX_GEMINI_LOCATION=${get("VERTEX_GEMINI_LOCATION") || get("VERTEX_LOCATION") || "global"}`,
  "",
  "# ElevenLabs",
  `ELEVENLABS_API_KEY=${get("ELEVENLABS_API_KEY")}`,
  `ELEVENLABS_VOICE_ID=${get("ELEVENLABS_VOICE_ID")}`,
  `ELEVENLABS_MODEL=${get("ELEVENLABS_MODEL") || "eleven_v3"}`,
  "",
  "# Antryami catalogue — key is present; URL still empty so snapshot catalogue is used.",
  `ANTRYAMI_BASE_URL=${get("ANTRYAMI_BASE_URL") || get("ANTRYAMI_API_URL")}`,
  `ANTRYAMI_API_URL=${get("ANTRYAMI_API_URL") || get("ANTRYAMI_BASE_URL")}`,
  `ANTRYAMI_API_KEY=${get("ANTRYAMI_API_KEY")}`,
  "",
  "# ClickHouse",
  `CLICKHOUSE_URL=${get("CLICKHOUSE_URL")}`,
  `CLICKHOUSE_USER=${get("CLICKHOUSE_USER")}`,
  `CLICKHOUSE_PASSWORD=${get("CLICKHOUSE_PASSWORD") || get("CLICKHOUSE_PASS")}`,
  `CLICKHOUSE_PASS=${get("CLICKHOUSE_PASS") || get("CLICKHOUSE_PASSWORD")}`,
  `CLICKHOUSE_DB=${get("CLICKHOUSE_DB")}`,
  "",
];

writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
console.log("rewrote .env; SA JSON at secrets/gcp-sa.json");
console.log("has_vertex_project", Boolean(get("GCP_PROJECT_ID") || get("VERTEX_PROJECT")));
console.log("has_elevenlabs_key", Boolean(get("ELEVENLABS_API_KEY")));
console.log("has_antryami_key", Boolean(get("ANTRYAMI_API_KEY")));
console.log("has_antryami_url", Boolean(get("ANTRYAMI_API_URL") || get("ANTRYAMI_BASE_URL")));
console.log("has_clickhouse_url", Boolean(get("CLICKHOUSE_URL")));
console.log("sa_file", existsSync("secrets/gcp-sa.json"));
