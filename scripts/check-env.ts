import fs from "node:fs";
import path from "node:path";
import { env, providers } from "@/lib/env";
import { getVertex } from "@/providers/vertex";
import { getModel } from "@/lib/models";

function setEnvKey(key: string, value: string) {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (!line.startsWith(`${key}=`)) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) next.push(`${key}=${value}`);
  fs.writeFileSync(envPath, next.join("\n"), { mode: 0o600 });
  process.env[key] = value;
}

function mask(v: string): string {
  if (!v) return "(empty)";
  return `present (${v.length} chars)`;
}

function scoreVoice(v: { name: string; labels?: Record<string, string> }): number {
  const labels = v.labels ?? {};
  const blob = `${v.name} ${JSON.stringify(labels)}`.toLowerCase();
  let s = 0;
  if (labels.language === "hi") s += 8;
  if (labels.use_case === "social_media") s += 8;
  if (labels.gender === "male") s += 2;
  if (/(haryan|rajasth)/.test(blob)) s += 10;
  if (/hindi/.test(blob)) s += 3;
  if (/indian/.test(blob)) s += 1;
  return s;
}

async function main() {
  const report: Record<string, unknown> = {
    snapshot_mode: env.SNAPSHOT_MODE,
    storage_root: env.STORAGE_ROOT,
    vertex: {
      live: providers.vertex,
      project: env.VERTEX_PROJECT || "(empty)",
      location: env.VERTEX_LOCATION,
      plan_model: env.VERTEX_PLAN_MODEL || getModel("planning").id,
      creds_file: env.GOOGLE_APPLICATION_CREDENTIALS ? "present" : "missing",
    },
    elevenlabs: {
      live: providers.elevenlabs,
      key: mask(env.ELEVENLABS_API_KEY),
      voice_id: env.ELEVENLABS_VOICE_ID || "(pack placeholder — set ELEVENLABS_VOICE_ID)",
      model: env.ELEVENLABS_MODEL,
    },
    antryami: {
      live: providers.antryami,
      url: env.ANTRYAMI_BASE_URL || "(empty → snapshot catalogue)",
      key: mask(env.ANTRYAMI_API_KEY),
    },
    clickhouse: {
      live: providers.clickhouse,
      url: env.CLICKHOUSE_URL || "(empty)",
      user: env.CLICKHOUSE_USER || "(empty)",
      db: env.CLICKHOUSE_DB || "(default)",
      password: mask(env.CLICKHOUSE_PASSWORD),
    },
  };
  console.log(JSON.stringify(report, null, 2));

  if (providers.vertex) {
    try {
      const v = getVertex();
      await v.canary(getModel("judge").id);
      console.log("vertex ping: ok");
    } catch (e) {
      console.log("vertex ping: FAIL", (e as Error).message.slice(0, 300));
    }
  } else {
    console.log("vertex ping: skipped (snapshot)");
  }

  if (providers.elevenlabs) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
      });
      console.log("elevenlabs ping:", res.ok ? "ok" : `FAIL ${res.status}`);
      const voices = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
      });
      if (voices.ok) {
        const json = (await voices.json()) as {
          voices?: { voice_id: string; name: string; labels?: Record<string, string> }[];
        };
        const list = json.voices ?? [];
        console.log("elevenlabs voices:", list.length);
        if (!env.ELEVENLABS_VOICE_ID && list[0]) {
          const scored = [...list].sort((a, b) => scoreVoice(b) - scoreVoice(a));
          const pickVoice = scored[0] ?? list[0];
          setEnvKey("ELEVENLABS_VOICE_ID", pickVoice.voice_id);
          console.log(
            "elevenlabs: wrote ELEVENLABS_VOICE_ID from account voice:",
            pickVoice.name,
            pickVoice.labels?.language ?? "",
          );
        }
      }
    } catch (e) {
      console.log("elevenlabs ping: FAIL", (e as Error).message);
    }
  }

  if (providers.clickhouse) {
    try {
      const endpoint = new URL(env.CLICKHOUSE_URL);
      if (env.CLICKHOUSE_DB) endpoint.searchParams.set("database", env.CLICKHOUSE_DB);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          authorization:
            "Basic " + Buffer.from(`${env.CLICKHOUSE_USER}:${env.CLICKHOUSE_PASSWORD}`).toString("base64"),
        },
        body: "SELECT 1 AS ok FORMAT JSON",
      });
      const text = await res.text();
      console.log("clickhouse ping:", res.ok ? "ok" : `FAIL ${res.status} ${text.slice(0, 180)}`);
    } catch (e) {
      console.log("clickhouse ping: FAIL", (e as Error).message);
    }
  }

  if (!providers.antryami) {
    console.log("antryami: snapshot (ANTRYAMI_BASE_URL / ANTRYAMI_API_URL is empty)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
