import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { env, providers } from "@/lib/env";
import { sql } from "@/db/client";
import { getRedis } from "@/lib/redis";

function ok(name: string, detail = "") {
  console.log(`ok    ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail: string): never {
  console.error(`FAIL  ${name} — ${detail}`);
  process.exit(1);
}

async function main() {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (ffmpeg.status !== 0) fail("ffmpeg", "not on PATH");
  ok("ffmpeg", (ffmpeg.stdout.split("\n")[0] ?? "").slice(0, 60));

  try {
    const rows = await sql`select 1 as ok`;
    if (!rows[0]) fail("postgres", "empty ping");
    ok("postgres", env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@"));
  } catch (e) {
    fail("postgres", (e as Error).message);
  }

  try {
    const pong = await getRedis().ping();
    if (pong !== "PONG") fail("redis", String(pong));
    ok("redis", env.REDIS_URL);
  } catch (e) {
    fail("redis", (e as Error).message);
  }

  const media = ["ttl_hry_01.mp4", "ttl_raj_01.mp4"].map((f) =>
    path.resolve(process.cwd(), "data/media", f),
  );
  for (const p of media) {
    if (!fs.existsSync(p)) fail("media", `missing ${p} (run pnpm assets)`);
  }
  ok("media", "ttl_hry_01 + ttl_raj_01");

  const titles = await sql`select count(*)::int as n from titles`;
  const n = Number(titles[0]?.n ?? 0);
  if (n < 1) fail("seed", "no titles (run pnpm db:seed)");
  ok("seed", `${n} titles`);

  console.log(
    JSON.stringify(
      {
        snapshot_mode: env.SNAPSHOT_MODE,
        vertex: providers.vertex,
        elevenlabs: providers.elevenlabs,
        clickhouse: providers.clickhouse,
        antryami: providers.antryami,
        next: "pnpm dev  (or pnpm build && pnpm start)",
        make_promo: "Library → live title → Build intelligence → compose → Lock recipe and run",
        cli: "pnpm promo -- --title jalebi-har-s01e03 --format SC",
      },
      null,
      2,
    ),
  );

  await sql.end({ timeout: 2 }).catch(() => undefined);
  try {
    getRedis().disconnect();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
