import { z } from "zod";
import type { DialectCode} from "@/domain";
import { defaultSpoilerBoundaryMs, PromoError, RawScene, Title, type Page } from "@/domain";
import type { AntryamiPort } from "../ports";

/**
 * Antryami catalogue adapter. Endpoint shapes follow §23 (assumption A3); the mapping layer
 * below is the only thing to touch if the real API differs.
 */
const ApiTitle = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string(),
    name_native: z.string().optional(),
    title_native: z.string().optional(),
    dialect: z.string().optional(),
    language: z.string().optional(),
    synopsis: z.string().optional(),
    description: z.string().optional(),
    runtime_ms: z.number().optional(),
    duration_seconds: z.number().optional(),
    spoiler_boundary_ms: z.number().optional(),
    genre: z.array(z.string()).optional(),
    genres: z.array(z.string()).optional(),
    artwork_url: z.string().optional().nullable(),
    poster_url: z.string().optional().nullable(),
    deep_link: z.string().optional(),
    slug: z.string().optional(),
  })
  .passthrough();

const DIALECT_ALIASES: Record<string, DialectCode> = {
  haryanvi: "hry", hry: "hry", rajasthani: "raj", raj: "raj", bhojpuri: "bho", bho: "bho",
  gujarati: "guj", guj: "guj", marathi: "mar", mar: "mar", bengali: "ben", bangla: "ben", ben: "ben",
};

type ApiTitleT = z.output<typeof ApiTitle>;

function mapTitle(t: ApiTitleT): Title {
  const runtime = t.runtime_ms ?? (t.duration_seconds ? t.duration_seconds * 1000 : 0);
  const dialectRaw = (t.dialect ?? t.language ?? "").toLowerCase();
  const dialect = DIALECT_ALIASES[dialectRaw];
  if (!dialect) throw new PromoError("ASSUMPTION_VIOLATED", `Antryami title ${t.id} has unknown dialect "${dialectRaw}"`, { recovery: "Extend DIALECT_ALIASES in providers/antryami/real.ts" });
  if (!runtime) throw new PromoError("ASSUMPTION_VIOLATED", `Antryami title ${t.id} has no runtime`, { recovery: "Check A3: runtime_ms or duration_seconds field" });
  return Title.parse({
    id: t.id,
    name: t.name,
    name_native: t.name_native ?? t.title_native ?? t.name,
    dialect,
    synopsis: t.synopsis ?? t.description ?? "",
    runtime_ms: runtime,
    spoiler_boundary_ms: t.spoiler_boundary_ms ?? defaultSpoilerBoundaryMs(runtime),
    genre: t.genre ?? t.genres ?? [],
    artwork_url: t.artwork_url ?? t.poster_url ?? null,
    deep_link: t.deep_link ?? (t.slug ? `stage://title/${t.slug}` : `stage://title/${t.id}`),
    intelligence_built_at: null,
  });
}

export class RealAntryami implements AntryamiPort {
  readonly mode = "real" as const;
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private async get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    }).catch((e) => {
      throw new PromoError("PROVIDER_UNAVAILABLE", `Antryami unreachable: ${e instanceof Error ? e.message : String(e)}`, { retryable: true });
    });
    if (!res.ok) throw new PromoError("PROVIDER_UNAVAILABLE", `Antryami ${path} → ${res.status}`, { retryable: res.status >= 500 });
    return schema.parse(await res.json());
  }

  async listTitles(args: { dialect?: DialectCode; cursor?: string }): Promise<Page<Title>> {
    const q = new URLSearchParams();
    if (args.dialect) q.set("dialect", args.dialect);
    if (args.cursor) q.set("cursor", args.cursor);
    const PageShape: z.ZodType<{ items: ApiTitleT[]; next_cursor?: string | null } | ApiTitleT[], z.ZodTypeDef, unknown> = z
      .object({ items: z.array(ApiTitle), next_cursor: z.string().nullable().optional() })
      .or(z.array(ApiTitle));
    const j = await this.get(`/titles?${q}`, PageShape);
    const items = Array.isArray(j) ? j : j.items;
    return { items: items.map(mapTitle), next_cursor: Array.isArray(j) ? null : (j.next_cursor ?? null) };
  }

  async getTitle(id: string): Promise<Title> {
    const One: z.ZodType<ApiTitleT, z.ZodTypeDef, unknown> = ApiTitle;
    return mapTitle(await this.get(`/titles/${encodeURIComponent(id)}`, One));
  }

  async getScenes(id: string): Promise<RawScene[]> {
    const j = await this.get(
      `/titles/${encodeURIComponent(id)}/scenes`,
      z.array(z.object({ seq: z.number().optional(), index: z.number().optional(), start_ms: z.number(), end_ms: z.number() })),
    );
    return j.map((s, i) => RawScene.parse({ title_id: id, seq: s.seq ?? s.index ?? i, start_ms: s.start_ms, end_ms: s.end_ms }));
  }

  async getMasterUrl(id: string): Promise<string> {
    const j = await this.get(`/titles/${encodeURIComponent(id)}/master`, z.object({ url: z.string() }).or(z.object({ master_url: z.string() })));
    return "url" in j ? j.url : j.master_url;
  }

  async ping() {
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/titles?limit=1`, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
      return res.ok ? { ok: true } : { ok: false, error: `Antryami /titles returned ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
