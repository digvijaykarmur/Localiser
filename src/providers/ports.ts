import type { DialectCode, Page, Ratio, RawScene, Title, VoiceSettings } from "@/domain";
import type { JSONSchema } from "@/lib/json";

export type Content = { text: string } | { image: Buffer; mimeType: string } | { audio: Buffer; mimeType: string };

export interface ModelCallMeta {
  stage: string;
  prompt_version: string;
  recipe_id?: string | null;
  title_id?: string | null;
}

export interface GenerateResult<T> {
  value: T;
  raw_text: string;
  cost_inr: number;
  tokens: { in: number; out: number };
  latency_ms: number;
}

export interface VertexPort {
  readonly mode: "real" | "snapshot";
  generate<T>(args: {
    model: string;
    system: string;
    user: Content[];
    schema: JSONSchema;
    temperature: number;
    seed?: number;
    meta: ModelCallMeta;
  }): Promise<GenerateResult<T>>;

  vision<T>(args: { model: string; system: string; images: Buffer[]; text: string; schema: JSONSchema; temperature?: number; meta: ModelCallMeta }): Promise<GenerateResult<T>>;

  image(args: { model: string; prompt: string; ratio: Ratio; meta: ModelCallMeta }): Promise<{ png: Buffer; cost_inr: number }>;

  video(args: { model: string; prompt: string; ratio: Ratio; duration_ms: number; reference?: Buffer; meta: ModelCallMeta }): Promise<{ mp4: Buffer; cost_inr: number }>;

  transcribe(args: { model: string; audio: Buffer; mimeType?: string; languageHint?: string; meta: ModelCallMeta }): Promise<{ text: string; cost_inr: number }>;

  canary(modelId: string): Promise<{ ok: boolean; error?: string; latency_ms: number }>;
}

export interface ElevenLabsPort {
  readonly mode: "real" | "snapshot";
  tts(args: { voice_id: string; model: string; text: string; settings: VoiceSettings; language_code?: string }): Promise<{ mp3: Buffer; ms: number; cost_inr: number }>;
  music(args: { model: string; brief: string; duration_ms: number }): Promise<{ mp3: Buffer; cost_inr: number }>;
  listVoices(): Promise<{ voice_id: string; name: string; labels: Record<string, string> }[]>;
  ping(): Promise<{ ok: boolean; error?: string }>;
}

export interface AntryamiPort {
  readonly mode: "real" | "snapshot";
  listTitles(args: { dialect?: DialectCode; cursor?: string }): Promise<Page<Title>>;
  getTitle(id: string): Promise<Title>;
  getScenes(id: string): Promise<RawScene[]>;
  /** Assumption A1: master video is retrievable. Returns a URL or local path. */
  getMasterUrl(id: string): Promise<string>;
  ping(): Promise<{ ok: boolean; error?: string }>;
}

export interface PerformanceRow {
  promo_id: string;
  published_at: string | null;
  impressions: number;
  view_3s: number;
  views_complete: number;
  clicks: number;
}

export interface ClickHousePort {
  readonly mode: "real" | "snapshot";
  getScenes(titleId: string): Promise<RawScene[]>;
  getPromoPerformance(sinceDays: number): Promise<PerformanceRow[]>;
  ping(): Promise<{ ok: boolean; error?: string }>;
}

export interface StoragePort {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  url(key: string): Promise<string>;
  /** Absolute local path for tools like ffmpeg (fs driver) or a materialised temp copy (gcs). */
  localPath(key: string): Promise<string>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}
