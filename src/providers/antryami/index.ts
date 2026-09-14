import fs from "node:fs";
import path from "node:path";
import { Title, SPOILER_BOUNDARY_DEFAULT_FRAC } from "@/domain";
import type { AntryamiAssets, AntryamiPort, AntryamiScene, AntryamiShot } from "./port";
import { env, providers } from "@/lib/env";
import { dialectAliases, mapDialect } from "@/lib/dialect";

export type { AntryamiPort, AntryamiScene, AntryamiShot, AntryamiAssets } from "./port";

type ContentListItem = {
  id: string;
  meta?: {
    title?: string;
    episode_title?: string;
    dialect?: string;
    slug?: string;
    content_type?: string;
    thumbnailURL?: string;
    video_url?: string;
    runtime_minutes?: number;
    runtime_sec?: number;
  };
  dna_headline?: { genre?: string; theme?: string; story_world?: string; tone?: string };
};

function snapRoot() {
  return path.resolve(process.cwd(), "data/snapshots/antryami");
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function asUrl(s: unknown): string | null {
  if (typeof s !== "string" || !s.trim()) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return s;
  } catch {
    return null;
  }
}

function runtimeMs(meta: ContentListItem["meta"] | undefined, fallbackSec = 1200): number {
  const sec = Number(meta?.runtime_sec || (meta?.runtime_minutes ? meta.runtime_minutes * 60 : 0));
  return Math.max(1000, Math.round((sec || fallbackSec) * 1000));
}

function titleFromItem(item: ContentListItem, extra?: { synopsis?: string; genre?: string[] }): Title | null {
  const dialect = mapDialect(item.meta?.dialect);
  if (!dialect) return null;
  const name = (item.meta?.title || item.id).trim();
  const episode = item.meta?.episode_title?.trim();
  const display = episode && episode !== name ? `${name} — ${episode}` : name;
  const runtime = runtimeMs(item.meta);
  const synopsis =
    extra?.synopsis ||
    [item.dna_headline?.theme, item.dna_headline?.story_world, item.dna_headline?.tone].filter(Boolean).join(" · ") ||
    display;
  const genre = extra?.genre?.length
    ? extra.genre
    : item.dna_headline?.genre
      ? [item.dna_headline.genre]
      : ["drama"];
  return Title.parse({
    id: item.id,
    name: display,
    name_native: display,
    dialect,
    synopsis: synopsis.slice(0, 800),
    runtime_ms: runtime,
    spoiler_boundary_ms: Math.max(1000, Math.floor(runtime * SPOILER_BOUNDARY_DEFAULT_FRAC)),
    genre,
    artwork_url: asUrl(item.meta?.thumbnailURL),
    deep_link: `stage://title/${item.id}`,
  });
}

export class SnapshotAntryami implements AntryamiPort {
  async listTitles(args: { dialect?: string; limit?: number }): Promise<{
    titles: Title[];
    cursor: string | null;
  }> {
    const all = readJson<Title[]>(path.join(snapRoot(), "titles.json")).map(normalizeTitle);
    const filtered = args.dialect ? all.filter((t) => t.dialect === args.dialect) : all;
    const limit = args.limit ?? 50;
    return { titles: filtered.slice(0, limit), cursor: null };
  }

  async getTitle(id: string): Promise<Title> {
    const p = path.join(snapRoot(), "titles", `${id}.json`);
    if (fs.existsSync(p)) return normalizeTitle(readJson<Title>(p));
    const listed = await this.listTitles({});
    const hit = listed.titles.find((t) => t.id === id);
    if (!hit) throw new Error(`title not found: ${id}`);
    return hit;
  }

  async getScenes(id: string): Promise<AntryamiScene[]> {
    const p = path.join(snapRoot(), "titles", id, "scenes.json");
    if (!fs.existsSync(p)) return [];
    return readJson<AntryamiScene[]>(p);
  }
}

export class LiveAntryami implements AntryamiPort {
  private listCache: { at: number; items: ContentListItem[] } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async getJson<T>(pathname: string): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, "")}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`antaryami ${pathname} ${res.status}: ${t.slice(0, 240)}`);
    }
    return (await res.json()) as T;
  }

  private async listItems(): Promise<ContentListItem[]> {
    const now = Date.now();
    if (this.listCache && now - this.listCache.at < 5 * 60_000) return this.listCache.items;
    const data = await this.getJson<{ items?: ContentListItem[] }>("/content");
    const items = data.items ?? [];
    this.listCache = { at: now, items };
    return items;
  }

  async listTitles(args: { dialect?: string; limit?: number; cursor?: string }) {
    void args.cursor;
    const aliases = args.dialect ? new Set(dialectAliases(args.dialect)) : null;
    const titles: Title[] = [];
    for (const item of await this.listItems()) {
      if (aliases && !aliases.has((item.meta?.dialect || "").toLowerCase())) continue;
      const t = titleFromItem(item);
      if (t) titles.push(t);
    }
    titles.sort((a, b) => Number(Boolean(b.artwork_url)) - Number(Boolean(a.artwork_url)));
    return { titles: titles.slice(0, args.limit ?? 40), cursor: null };
  }

  async getTitle(id: string) {
    const data = await this.getJson<{
      id: string;
      meta?: ContentListItem["meta"];
      dna_headline?: ContentListItem["dna_headline"];
      scenes?: { summary?: string }[];
    }>(`/content/${encodeURIComponent(id)}`);
    const synopsis = data.scenes?.find((s) => s.summary)?.summary;
    const t = titleFromItem(
      { id: data.id, meta: data.meta, dna_headline: data.dna_headline },
      { synopsis, genre: data.dna_headline?.genre ? [data.dna_headline.genre] : undefined },
    );
    if (!t) throw new Error(`title ${id} has unmapped dialect ${data.meta?.dialect}`);
    return t;
  }

  async getScenes(id: string): Promise<AntryamiScene[]> {
    const data = await this.getJson<{
      scenes?: Array<{
        scene_id: string;
        start_sec: number;
        end_sec: number;
        summary?: string;
        label?: string;
        spoiler?: { is_spoiler?: boolean };
        scene_intel?: { is_spoiler?: boolean };
        dramatic_intensity?: number;
        characters_present?: string[];
        conflict_type?: string;
        quotable_lines?: Array<{ text?: string } | string>;
      }>;
    }>(`/content/${encodeURIComponent(id)}/scenes`);
    return (data.scenes ?? []).map((s) => {
      const q = s.quotable_lines?.[0];
      const quotable = typeof q === "string" ? q : q?.text ?? null;
      return {
        scene_id: s.scene_id,
        start_ms: Math.round((s.start_sec ?? 0) * 1000),
        end_ms: Math.max(Math.round((s.end_sec ?? s.start_sec ?? 0) * 1000), Math.round((s.start_sec ?? 0) * 1000) + 400),
        frame_url: null,
        has_dialogue: Boolean(quotable),
        summary: s.summary,
        label: s.label,
        spoiler: Boolean(s.spoiler?.is_spoiler || s.scene_intel?.is_spoiler),
        intensity: s.dramatic_intensity,
        characters: s.characters_present,
        conflict: s.conflict_type,
        quotable,
      };
    });
  }

  async getShots(id: string): Promise<AntryamiShot[]> {
    const data = await this.getJson<{
      shots?: Array<{
        shot_id: string;
        scene_id: string;
        start_sec: number;
        end_sec: number;
        shot_scale?: string;
        action?: string;
        camera?: string;
        characters_present?: string[];
      }>;
    }>(`/content/${encodeURIComponent(id)}/shots`);
    return (data.shots ?? []).map((s) => ({
      shot_id: s.shot_id,
      scene_id: s.scene_id,
      start_ms: Math.round((s.start_sec ?? 0) * 1000),
      end_ms: Math.max(Math.round((s.end_sec ?? s.start_sec ?? 0) * 1000), Math.round((s.start_sec ?? 0) * 1000) + 400),
      shot_scale: s.shot_scale || "MS",
      action: s.action || "",
      camera: s.camera || "static",
      characters: s.characters_present ?? [],
    }));
  }

  async getAssets(id: string): Promise<AntryamiAssets> {
    const data = await this.getJson<{
      runtime_sec?: number;
      video?: { analysed?: { url?: string }; master?: { url?: string } };
      title?: string;
    }>(`/content/${encodeURIComponent(id)}/assets`);
    const detail = await this.getJson<{ meta?: { thumbnailURL?: string; video_url?: string; runtime_sec?: number } }>(
      `/content/${encodeURIComponent(id)}`,
    );
    return {
      video_url: asUrl(data.video?.analysed?.url) || asUrl(data.video?.master?.url) || asUrl(detail.meta?.video_url),
      poster_url: asUrl(detail.meta?.thumbnailURL),
      runtime_sec: Number(data.runtime_sec || detail.meta?.runtime_sec || 90),
    };
  }
}

function normalizeTitle(t: Title): Title {
  const runtime = t.runtime_ms;
  const spoiler = t.spoiler_boundary_ms || Math.floor(runtime * SPOILER_BOUNDARY_DEFAULT_FRAC);
  return Title.parse({ ...t, spoiler_boundary_ms: spoiler });
}

export function getAntryami(): AntryamiPort {
  if (!providers.antryami) return new SnapshotAntryami();
  return new LiveAntryami(env.ANTRYAMI_BASE_URL, env.ANTRYAMI_API_KEY);
}
