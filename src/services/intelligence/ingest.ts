import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { PromoError, type DialectCode, type RawScene, type Title } from "@/domain";
import { ffmpeg, ffprobeJson } from "@/lib/ffmpeg";
import { log } from "@/lib/log";
import { antryami, clickhouse, keys, storage } from "@/providers";

const logger = log("ingest");

/** S1a — sync catalogue titles into Postgres. Titles appear as they arrive. */
export async function syncTitles(dialect?: DialectCode): Promise<{ synced: number; titles: Title[] }> {
  const a = await antryami();
  const out: Title[] = [];
  let cursor: string | undefined;
  do {
    const page = await a.listTitles({ dialect, cursor });
    for (const t of page.items) {
      await db
        .insert(schema.titles)
        .values({
          id: t.id,
          name: t.name,
          nameNative: t.name_native,
          dialect: t.dialect,
          synopsis: t.synopsis,
          runtimeMs: t.runtime_ms,
          spoilerBoundaryMs: t.spoiler_boundary_ms,
          genre: t.genre,
          artworkUrl: t.artwork_url,
          deepLink: t.deep_link,
        })
        .onConflictDoUpdate({
          target: schema.titles.id,
          set: { name: t.name, nameNative: t.name_native, synopsis: t.synopsis, runtimeMs: t.runtime_ms, genre: t.genre, artworkUrl: t.artwork_url, deepLink: t.deep_link, fetchedAt: new Date() },
        });
      out.push(t);
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  logger.info("titles synced", { count: out.length });
  return { synced: out.length, titles: out };
}

/** Scene boundaries: ClickHouse first (A4), Antryami as fallback (A2). */
export async function fetchScenes(titleId: string): Promise<RawScene[]> {
  const ch = await clickhouse();
  let scenes: RawScene[] = [];
  try {
    scenes = await ch.getScenes(titleId);
  } catch (e) {
    logger.warn("clickhouse scenes failed, trying antryami", { titleId, error: String(e) });
  }
  if (scenes.length === 0) scenes = await (await antryami()).getScenes(titleId);
  if (scenes.length === 0)
    throw new PromoError("ASSUMPTION_VIOLATED", `No scene boundaries for ${titleId} (assumption A2).`, {
      recovery: "Check screening.scenes in ClickHouse or the Antryami /scenes endpoint. Shot detection is not implemented in v1.",
    });
  return scenes.sort((a, b) => a.seq - b.seq);
}

/** Assumption A1: the master must be retrievable. Materialise into storage once. */
export async function ensureMaster(titleId: string): Promise<string> {
  const row = await db.query.titles.findFirst({ where: eq(schema.titles.id, titleId) });
  if (!row) throw new PromoError("NOT_FOUND", `Title ${titleId} not found`);
  const key = keys.master(titleId);
  const st = storage();
  if (row.masterStorageKey && (await st.exists(key))) return st.localPath(key);

  const url = await (await antryami()).getMasterUrl(titleId);
  let buf: Buffer;
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url).catch((e) => {
      throw new PromoError("ASSUMPTION_VIOLATED", `Master for ${titleId} not retrievable (A1): ${e instanceof Error ? e.message : String(e)}`);
    });
    if (!res.ok) throw new PromoError("ASSUMPTION_VIOLATED", `Master for ${titleId} not retrievable (A1): HTTP ${res.status}`, { recovery: "Verify A1 with the Antryami team before continuing." });
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    buf = await fs.readFile(url);
  }
  await st.put(key, buf, "video/mp4");
  const probe = await ffprobeJson(await st.localPath(key));
  const v = probe.streams.find((s) => s.codec_type === "video");
  if (!v || v.width !== 1920 || v.height !== 1080) {
    logger.warn("master is not 1920x1080; composition arithmetic assumes a 16:9 1080p master", { titleId, w: v?.width, h: v?.height });
  }
  await db.update(schema.titles).set({ masterStorageKey: key }).where(eq(schema.titles.id, titleId));
  return st.localPath(key);
}

/** S1b — three frames per scene at 15/50/85%, 640px wide (§17.1). Idempotent. */
export async function extractFrames(titleId: string, scenes: RawScene[], onProgress?: (done: number, total: number) => void): Promise<Map<number, string[]>> {
  const master = await ensureMaster(titleId);
  const st = storage();
  const out = new Map<number, string[]>();
  let done = 0;
  for (const s of scenes) {
    const frameKeys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const frac = [0.15, 0.5, 0.85][i]!;
      const t = (s.start_ms + (s.end_ms - s.start_ms) * frac) / 1000;
      const key = keys.frame(titleId, s.seq, i);
      if (!(await st.exists(key))) {
        const outPath = await st.localPath(key);
        await ffmpeg(["-ss", t.toFixed(3), "-i", master, "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "3", outPath], { timeoutMs: 60_000 });
      }
      frameKeys.push(key);
    }
    out.set(s.seq, frameKeys);
    await db
      .insert(schema.scenes)
      .values({ titleId, seq: s.seq, startMs: s.start_ms, endMs: s.end_ms, frameKeys })
      .onConflictDoUpdate({ target: [schema.scenes.titleId, schema.scenes.seq], set: { startMs: s.start_ms, endMs: s.end_ms, frameKeys } });
    done++;
    onProgress?.(done, scenes.length);
  }
  await db.update(schema.titles).set({ sceneCount: scenes.length }).where(eq(schema.titles.id, titleId));
  return out;
}
