import type { ZodType } from "zod";

export interface GenerateJsonArgs<T> {
  model: string;
  systemInstruction: string;
  user: unknown;
  schema: ZodType<T>;
  temperature: number;
  seed?: number;
  stage: string;
  recipeId: string | null;
  promptVersion: string;
}

export interface GenerateJsonResult<T> {
  parsed: T;
  raw: string;
  cost_inr: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  call_id: string;
  schema_ok: boolean;
}

export interface VertexPort {
  generateJson<T>(args: GenerateJsonArgs<T>): Promise<GenerateJsonResult<T>>;
  transcribeAudio(args: { assetPath: string; recipeId: string | null }): Promise<{
    text: string;
    cost_inr: number;
  }>;
  generateImage(args: {
    prompt: string;
    width: number;
    height: number;
    recipeId: string | null;
  }): Promise<{ buffer: Buffer; cost_inr: number }>;
  generateVideo(args: {
    prompt: string;
    width: number;
    height: number;
    durationMs: number;
    recipeId: string | null;
    outPath: string;
  }): Promise<{ path: string; cost_inr: number }>;
  canary(model: string): Promise<void>;
}
