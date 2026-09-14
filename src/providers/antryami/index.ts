import fs from "node:fs";
import path from "node:path";
import { Title, SPOILER_BOUNDARY_DEFAULT_FRAC } from "@/domain";
import type { AntryamiPort, AntryamiScene } from "./port";
import { env, providers } from "@/lib/env";

function snapRoot() {
  return path.resolve(process.cwd(), "data/snapshots/antryami");
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
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
    return readJson<AntryamiScene[]>(p);
  }
}

export class LiveAntryami implements AntryamiPort {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async get<T>(pathname: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${pathname}`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`antryami ${pathname} ${res.status}`);
    return (await res.json()) as T;
  }

  async listTitles(args: { dialect?: string; limit?: number; cursor?: string }) {
    const q = new URLSearchParams();
    if (args.dialect) q.set("dialect", args.dialect);
    if (args.limit) q.set("limit", String(args.limit));
    if (args.cursor) q.set("cursor", args.cursor);
    const data = await this.get<{ titles: Title[]; cursor: string | null }>(`/titles?${q}`);
    return { titles: data.titles.map(normalizeTitle), cursor: data.cursor };
  }

  async getTitle(id: string) {
    return normalizeTitle(await this.get<Title>(`/titles/${id}`));
  }

  async getScenes(id: string) {
    return this.get<AntryamiScene[]>(`/titles/${id}/scenes`);
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
