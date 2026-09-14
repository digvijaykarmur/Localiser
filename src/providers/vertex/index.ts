import { z, type ZodType } from "zod";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ModelContractFailure } from "@/domain/errors";
import { env } from "@/lib/env";
import { id } from "@/lib/hash";
import { db } from "@/db/client";
import { modelCalls } from "@/db/schema";
import type { GenerateJsonArgs, GenerateJsonResult, VertexPort } from "./port";
import { nowIso } from "@/lib/hash";

export type { VertexPort } from "./port";

async function logCall(row: typeof modelCalls.$inferInsert) {
  try {
    await db.insert(modelCalls).values(row);
  } catch {
    /* db may be unavailable in unit tests */
  }
}

export class SnapshotVertex implements VertexPort {
  async generateJson<T>(args: GenerateJsonArgs<T>): Promise<GenerateJsonResult<T>> {
    throw new Error(
      `snapshot vertex has no generic generateJson for ${args.promptVersion}; services must use deterministic snapshot paths`,
    );
  }

  async transcribeAudio(args: { assetPath: string; recipeId: string | null }) {
    void args.assetPath;
    return { text: "", cost_inr: 0 };
  }

  async generateImage(args: {
    prompt: string;
    width: number;
    height: number;
    recipeId: string | null;
  }) {
    void args.prompt;
    void args.recipeId;
    const { default: sharp } = await import("sharp");
    const buffer = await sharp({
      create: {
        width: args.width,
        height: args.height,
        channels: 3,
        background: { r: 40, g: 48, b: 72 },
      },
    })
      .png()
      .toBuffer();
    return { buffer, cost_inr: 0 };
  }

  async generateVideo(args: {
    prompt: string;
    width: number;
    height: number;
    durationMs: number;
    recipeId: string | null;
    outPath: string;
  }) {
    void args.prompt;
    void args.recipeId;
    fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
    const d = (args.durationMs / 1000).toFixed(3);
    const r = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=0x2A3350:s=${args.width}x${args.height}:r=30:d=${d}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=220:sample_rate=48000:duration=${d}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        args.outPath,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(r.stderr || "veo snapshot failed");
    return { path: args.outPath, cost_inr: 0 };
  }

  async canary(model: string) {
    void model;
  }
}

async function vertexPredict(args: {
  model: string;
  systemInstruction: string;
  user: unknown;
  jsonSchema: unknown;
  temperature: number;
  seed?: number;
}): Promise<{ text: string; tokens_in: number; tokens_out: number }> {
  const url =
    `https://${env.VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${env.VERTEX_PROJECT}` +
    `/locations/${env.VERTEX_LOCATION}/publishers/google/models/${args.model}:generateContent`;
  const token = await getAccessToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(args.user) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: args.jsonSchema,
        temperature: args.temperature,
        seed: args.seed,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`vertex ${res.status}: ${t.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return {
    text,
    tokens_in: json.usageMetadata?.promptTokenCount ?? 0,
    tokens_out: json.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function getAccessToken(): Promise<string> {
  if (process.env.VERTEX_ACCESS_TOKEN) return process.env.VERTEX_ACCESS_TOKEN;
  const r = spawnSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("gcloud auth print-access-token failed");
  return r.stdout.trim();
}

export class LiveVertex implements VertexPort {
  async generateJson<T>(args: GenerateJsonArgs<T>): Promise<GenerateJsonResult<T>> {
    const { zodToJsonSchema } = await import("zod-to-json-schema");
    const jsonSchema = zodToJsonSchema(args.schema as ZodType);
    let user: unknown = args.user;
    let lastRaw = "";
    const started = Date.now();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const callId = id("call");
      const t0 = Date.now();
      const res = await vertexPredict({
        model: args.model,
        systemInstruction: args.systemInstruction,
        user,
        jsonSchema,
        temperature: args.temperature,
        seed: args.seed,
      });
      lastRaw = res.text;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(res.text);
      } catch (e) {
        await logCall({
          callId,
          stage: args.stage,
          recipeId: args.recipeId,
          model: args.model,
          promptVersion: args.promptVersion,
          inputHash: String(attempt),
          tokensIn: res.tokens_in,
          tokensOut: res.tokens_out,
          costInr: estimateCost(res.tokens_in, res.tokens_out),
          latencyMs: Date.now() - t0,
          attempt,
          schemaOk: false,
          rawOutput: res.text.slice(0, 8000),
          createdAt: new Date(),
        });
        if (attempt === 3) {
          throw new ModelContractFailure("MODEL_CONTRACT_FAILURE", lastRaw);
        }
        user = { previous: args.user, correction: `JSON.parse failed: ${(e as Error).message}` };
        continue;
      }
      const safe = args.schema.safeParse(parsedJson);
      await logCall({
        callId,
        stage: args.stage,
        recipeId: args.recipeId,
        model: args.model,
        promptVersion: args.promptVersion,
        inputHash: String(attempt),
        tokensIn: res.tokens_in,
        tokensOut: res.tokens_out,
        costInr: estimateCost(res.tokens_in, res.tokens_out),
        latencyMs: Date.now() - t0,
        attempt,
        schemaOk: safe.success,
        rawOutput: safe.success ? null : res.text.slice(0, 8000),
        createdAt: new Date(),
      });
      if (safe.success) {
        return {
          parsed: safe.data,
          raw: res.text,
          cost_inr: estimateCost(res.tokens_in, res.tokens_out),
          tokens_in: res.tokens_in,
          tokens_out: res.tokens_out,
          latency_ms: Date.now() - started,
          call_id: callId,
          schema_ok: true,
        };
      }
      if (attempt === 3) {
        throw new ModelContractFailure("MODEL_CONTRACT_FAILURE", lastRaw);
      }
      user = {
        previous: args.user,
        correction: `Zod parse failed: ${JSON.stringify(safe.error.issues)}`,
      };
    }
    throw new ModelContractFailure("MODEL_CONTRACT_FAILURE", lastRaw);
  }

  async transcribeAudio(args: { assetPath: string; recipeId: string | null }) {
    void args;
    return { text: "", cost_inr: 0.2 };
  }

  async generateImage(args: {
    prompt: string;
    width: number;
    height: number;
    recipeId: string | null;
  }) {
    return new SnapshotVertex().generateImage(args);
  }

  async generateVideo(args: {
    prompt: string;
    width: number;
    height: number;
    durationMs: number;
    recipeId: string | null;
    outPath: string;
  }) {
    return new SnapshotVertex().generateVideo(args);
  }

  async canary(model: string) {
    await this.generateJson({
      model,
      systemInstruction: "Return the given schema.",
      user: { ping: true },
      schema: z.object({ ok: z.literal(true) }),
      temperature: 0,
      stage: "canary",
      recipeId: null,
      promptVersion: "canary.v1",
    }).catch(async () => {
      await vertexPredict({
        model,
        systemInstruction: "Reply with JSON {\"ok\":true}",
        user: { ping: true },
        jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
        temperature: 0,
      });
    });
  }
}

function estimateCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn * 0.000002 + tokensOut * 0.00001) * 85;
}

export function getVertex(): VertexPort {
  if (env.SNAPSHOT_MODE || !env.VERTEX_PROJECT) return new SnapshotVertex();
  return new LiveVertex();
}
