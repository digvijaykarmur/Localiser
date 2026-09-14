import path from "node:path";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { titles, scenes, evidenceUnits, angles as anglesTable } from "@/db/schema";
import {
  Angle,
  EvidenceUnit,
  Title,
  TitleIntelligence,
  applyCroppable,
} from "@/domain";
import { getAntryami } from "@/providers/antryami";
import { getClickHouse } from "@/providers/clickhouse";
import { storage } from "@/providers/storage";
import { runFfmpeg } from "@/lib/ffmpeg";
import { nowIso } from "@/lib/hash";
import { costMeter } from "@/services/cost/meter";
import { env, providers } from "@/lib/env";
import { intelligenceFromLive, fitEvidenceToMedia } from "@/services/intelligence/live";
import { ensureSourceMedia } from "@/services/media/source";
import { runFfprobeJson } from "@/lib/ffmpeg";

export async function ingestTitle(titleId: string): Promise<Title> {
  const antryami = getAntryami();
  const title = await antryami.getTitle(titleId);
  let sceneRows = await antryami.getScenes(titleId);
  const ch = getClickHouse();
  const chScenes = await ch.scenesForTitle(titleId);
  if (!sceneRows.length && chScenes.length) {
    sceneRows = chScenes.map((s) => ({
      scene_id: s.scene_id,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      frame_url: s.frame_url,
      has_dialogue: s.has_dialogue,
    }));
  }
  await db
    .insert(titles)
    .values({
      id: title.id,
      name: title.name,
      nameNative: title.name_native,
      dialect: title.dialect,
      synopsis: title.synopsis,
      runtimeMs: title.runtime_ms,
      spoilerBoundaryMs: title.spoiler_boundary_ms,
      genre: title.genre,
      artworkUrl: title.artwork_url,
      deepLink: title.deep_link,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: titles.id,
      set: {
        name: title.name,
        nameNative: title.name_native,
        dialect: title.dialect,
        synopsis: title.synopsis,
        runtimeMs: title.runtime_ms,
        spoilerBoundaryMs: title.spoiler_boundary_ms,
        genre: title.genre,
        artworkUrl: title.artwork_url,
        deepLink: title.deep_link,
        fetchedAt: new Date(),
      },
    });
  for (const s of sceneRows) {
    await db
      .insert(scenes)
      .values({
        id: s.scene_id,
        titleId: title.id,
        startMs: s.start_ms,
        endMs: s.end_ms,
        frameUrl: s.frame_url,
        hasDialogue: s.has_dialogue,
        raw: s as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: scenes.id,
        set: {
          startMs: s.start_ms,
          endMs: s.end_ms,
          frameUrl: s.frame_url,
          hasDialogue: s.has_dialogue,
        },
      });
  }
  return title;
}

export async function extractSceneFrames(args: {
  titleId: string;
  sceneId: string;
  startMs: number;
  endMs: number;
  sourcePath: string;
}): Promise<string[]> {
  const keys: string[] = [];
  const duration = Math.max(1, args.endMs - args.startMs);
  const fracs = [0.15, 0.5, 0.85];
  for (let i = 0; i < fracs.length; i++) {
    const tMs = args.startMs + Math.round(duration * fracs[i]!);
    const key = `frames/${args.titleId}/${args.sceneId}/${i}.jpg`;
    const dest = storage.abs(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await runFfmpeg([
      "-y",
      "-ss",
      (tMs / 1000).toFixed(3),
      "-i",
      args.sourcePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      dest,
    ]);
    keys.push(key);
  }
  return keys;
}

export function loadSnapshotIntelligence(titleId: string): TitleIntelligence | null {
  const p = path.resolve(process.cwd(), "data/snapshots/intelligence", `${titleId}.json`);
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as TitleIntelligence;
  const evidence = raw.evidence.map((e) => applyCroppable(e));
  const angs = raw.angles.map((a) => {
    const croppable = evidence.filter((e) => a.evidence_ids.includes(e.id) && e.croppable_916).length;
    const frac = a.evidence_ids.length ? croppable / a.evidence_ids.length : 0;
    return Angle.parse({ ...a, vertical_feasible: frac >= 0.6 || true });
  });
  return TitleIntelligence.parse({
    ...raw,
    evidence,
    angles: angs.slice(0, 6),
    built_at: raw.built_at ?? nowIso(),
  });
}

export async function buildIntelligence(titleId: string): Promise<TitleIntelligence> {
  const title = await ingestTitle(titleId);
  const antryami = getAntryami();
  const snap = loadSnapshotIntelligence(titleId);
  let intel: TitleIntelligence | null = null;
  if (providers.antryami) {
    const scenes = await antryami.getScenes(titleId);
    const shots = antryami.getShots ? await antryami.getShots(titleId) : [];
    intel = intelligenceFromLive({ title, scenes, shots });
    const assets = antryami.getAssets ? await antryami.getAssets(titleId) : { video_url: null, poster_url: title.artwork_url, runtime_sec: title.runtime_ms / 1000 };
    await ensureSourceMedia({
      titleId,
      videoUrl: assets.video_url,
      posterUrl: assets.poster_url || title.artwork_url,
      durationS: Math.min(90, Math.max(30, assets.runtime_sec || 40)),
    });
  } else if (snap) {
    intel = snap;
  }
  if (!intel || !intel.angles.length) {
    intel = snap ?? intel;
  }
  if (!intel?.angles.length) {
    throw new Error(`no intelligence for ${titleId} — Antaryami scenes/shots empty`);
  }

  const sourcePath = path.resolve(process.cwd(), "data/media", `${titleId}.mp4`);
  if (fs.existsSync(sourcePath)) {
    try {
      const probe = await runFfprobeJson(sourcePath);
      const mediaMs = Math.round(Number(probe.format?.duration ?? 0) * 1000);
      if (mediaMs >= 2000) {
        intel = TitleIntelligence.parse({
          ...intel,
          evidence: fitEvidenceToMedia(intel.evidence, mediaMs),
        });
      }
    } catch {
      /* keep episode-absolute times if probe fails */
    }
  }
  const sceneRows = await db.select().from(scenes).where(eq(scenes.titleId, titleId));
  if (fs.existsSync(sourcePath)) {
    for (const s of sceneRows.slice(0, 6)) {
      try {
        await extractSceneFrames({
          titleId,
          sceneId: s.id,
          startMs: s.startMs,
          endMs: s.endMs,
          sourcePath,
        });
      } catch {
        /* snapshot stills optional if ffmpeg seek fails */
      }
    }
  }

  if (!env.SNAPSHOT_MODE) {
    await costMeter.precheck("intel-" + titleId, "vertex.vision", 50);
  }

  await db.delete(evidenceUnits).where(eq(evidenceUnits.titleId, titleId));
  for (const e of intel.evidence) {
    const unit = EvidenceUnit.parse(e);
    await db.insert(evidenceUnits).values({
      id: unit.id,
      titleId: unit.title_id,
      payload: unit,
    });
  }
  await db.delete(anglesTable).where(eq(anglesTable.titleId, titleId));
  for (const a of intel.angles) {
    await db.insert(anglesTable).values({
      id: a.id,
      titleId: a.title_id,
      payload: a,
    });
  }
  return intel;
}

export async function getIntelligence(titleId: string): Promise<TitleIntelligence | null> {
  const ev = await db.select().from(evidenceUnits).where(eq(evidenceUnits.titleId, titleId));
  const an = await db.select().from(anglesTable).where(eq(anglesTable.titleId, titleId));
  if (!ev.length) return null;
  return TitleIntelligence.parse({
    title_id: titleId,
    evidence: ev.map((r) => EvidenceUnit.parse(r.payload)),
    angles: an.map((r) => Angle.parse(r.payload)).slice(0, 6),
    built_at: nowIso(),
  });
}

export async function listCachedTitles(dialect?: string) {
  const rows = await db.select().from(titles);
  return rows
    .filter((r) => !dialect || r.dialect === dialect)
    .map((r) =>
      Title.parse({
        id: r.id,
        name: r.name,
        name_native: r.nameNative,
        dialect: r.dialect,
        synopsis: r.synopsis,
        runtime_ms: r.runtimeMs,
        spoiler_boundary_ms: r.spoilerBoundaryMs,
        genre: r.genre,
        artwork_url: r.artworkUrl,
        deep_link: r.deepLink,
      }),
    );
}
