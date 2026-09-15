import { GoogleGenAI, type Content as GContent, type Part } from "@google/genai";
import { env } from "@/config/env";
import { models, round2, tokenCostInr } from "@/config/models";
import { ProviderUnavailable, type Ratio } from "@/domain";
import { safeJsonParse } from "@/lib/json";
import type { Content, GenerateResult, ModelCallMeta, VertexPort } from "../ports";

/**
 * Real Gemini/Veo adapter over @google/genai. Uses Vertex AI when VERTEX_PROJECT is set
 * (service-account credentials via GOOGLE_APPLICATION_CREDENTIALS), otherwise the Gemini
 * Developer API with GEMINI_API_KEY.
 */
export class RealVertex implements VertexPort {
  readonly mode = "real" as const;
  private readonly ai: GoogleGenAI;

  constructor() {
    if (env.VERTEX_PROJECT && env.GOOGLE_APPLICATION_CREDENTIALS) {
      this.ai = new GoogleGenAI({ vertexai: true, project: env.VERTEX_PROJECT, location: env.VERTEX_LOCATION });
    } else if (env.GEMINI_API_KEY) {
      this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    } else {
      throw new Error("RealVertex requires VERTEX_PROJECT + GOOGLE_APPLICATION_CREDENTIALS or GEMINI_API_KEY");
    }
  }

  private toParts(user: Content[]): Part[] {
    return user.map((c) => {
      if ("text" in c) return { text: c.text };
      if ("image" in c) return { inlineData: { data: c.image.toString("base64"), mimeType: c.mimeType } };
      return { inlineData: { data: c.audio.toString("base64"), mimeType: c.mimeType } };
    });
  }

  private wrap(e: unknown, provider = "Vertex"): never {
    const msg = e instanceof Error ? e.message : String(e);
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new ProviderUnavailable(provider, `quota exhausted (${msg.slice(0, 160)})`, "Resets 00:00 UTC.");
    if (/5\d\d|UNAVAILABLE|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg)) throw new ProviderUnavailable(provider, msg.slice(0, 200));
    throw e;
  }

  async generate<T>(args: Parameters<VertexPort["generate"]>[0]): Promise<GenerateResult<T>> {
    const t0 = Date.now();
    try {
      const contents: GContent[] = [{ role: "user", parts: this.toParts(args.user) }];
      const res = await this.ai.models.generateContent({
        model: args.model,
        contents,
        config: {
          systemInstruction: args.system,
          responseMimeType: "application/json",
          responseSchema: args.schema as never,
          temperature: args.temperature,
          seed: args.seed,
        },
      });
      const text = res.text ?? "";
      const u = res.usageMetadata;
      const tokens = { in: u?.promptTokenCount ?? 0, out: u?.candidatesTokenCount ?? 0 };
      return {
        value: safeJsonParse(text) as T,
        raw_text: text,
        cost_inr: tokenCostInr(args.model, tokens.in, tokens.out, env.INR_PER_USD),
        tokens,
        latency_ms: Date.now() - t0,
      };
    } catch (e) {
      if (e instanceof SyntaxError) throw e; // contract failure handled by caller
      this.wrap(e);
    }
  }

  async vision<T>(args: Parameters<VertexPort["vision"]>[0]): Promise<GenerateResult<T>> {
    return this.generate<T>({
      model: args.model,
      system: args.system,
      user: [...args.images.map((image) => ({ image, mimeType: "image/jpeg" })), { text: args.text }],
      schema: args.schema,
      temperature: args.temperature ?? 0.1,
      meta: args.meta,
    });
  }

  async image(args: Parameters<VertexPort["image"]>[0]): Promise<{ png: Buffer; cost_inr: number }> {
    try {
      const res = await this.ai.models.generateContent({
        model: args.model,
        contents: [{ role: "user", parts: [{ text: `${args.prompt}\n\nAspect ratio: ${args.ratio}.` }] }],
        config: { responseModalities: ["IMAGE"] as never, imageConfig: { aspectRatio: args.ratio } as never },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error("image model returned no image");
      return { png: Buffer.from(part.inlineData.data, "base64"), cost_inr: round2(models.pricing_usd_flat.image_per_call * env.INR_PER_USD) };
    } catch (e) {
      this.wrap(e);
    }
  }

  async video(args: Parameters<VertexPort["video"]>[0]): Promise<{ mp4: Buffer; cost_inr: number }> {
    const durationSeconds = Math.min(8, Math.max(4, Math.round(args.duration_ms / 1000)));
    const tryModel = async (model: string) => {
      let op = await this.ai.models.generateVideos({
        model,
        prompt: args.prompt,
        ...(args.reference ? { image: { imageBytes: args.reference.toString("base64"), mimeType: "image/png" } } : {}),
        config: {
          numberOfVideos: 1,
          durationSeconds,
          aspectRatio: args.ratio === "1:1" ? "9:16" : args.ratio,
          personGeneration: "allow_adult",
          generateAudio: false,
        },
      });
      const deadline = Date.now() + 10 * 60_000;
      while (!op.done) {
        if (Date.now() > deadline) throw new Error("Veo operation timed out after 10 minutes");
        await new Promise((r) => setTimeout(r, 8000));
        op = await this.ai.operations.getVideosOperation({ operation: op });
      }
      const v = op.response?.generatedVideos?.[0]?.video;
      if (!v) throw new Error(`Veo returned no video (${JSON.stringify(op.error ?? {}).slice(0, 200)})`);
      if (v.videoBytes) return Buffer.from(v.videoBytes, "base64");
      if (v.uri) {
        const r = await fetch(v.uri, { headers: env.GEMINI_API_KEY ? { "x-goog-api-key": env.GEMINI_API_KEY } : {} });
        if (!r.ok) throw new Error(`Veo download ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      }
      throw new Error("Veo video had neither bytes nor uri");
    };
    try {
      let mp4: Buffer;
      try {
        mp4 = await tryModel(args.model);
      } catch (e) {
        if (!models.video.fallback || models.video.fallback === args.model) throw e;
        mp4 = await tryModel(models.video.fallback);
      }
      return { mp4, cost_inr: round2(models.pricing_usd_flat.video_per_second * durationSeconds * env.INR_PER_USD) };
    } catch (e) {
      this.wrap(e, "Vertex Veo");
    }
  }

  async transcribe(args: Parameters<VertexPort["transcribe"]>[0]): Promise<{ text: string; cost_inr: number }> {
    try {
      const res = await this.ai.models.generateContent({
        model: args.model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { data: args.audio.toString("base64"), mimeType: args.mimeType ?? "audio/mp4" } },
              {
                text: `Transcribe this audio verbatim in its original script${args.languageHint ? ` (${args.languageHint})` : ""}. Output only the transcript text, no commentary, no romanisation.`,
              },
            ],
          },
        ],
        config: { temperature: 0 },
      });
      const u = res.usageMetadata;
      return { text: (res.text ?? "").trim(), cost_inr: tokenCostInr(args.model, u?.promptTokenCount ?? 0, u?.candidatesTokenCount ?? 0, env.INR_PER_USD) };
    } catch (e) {
      this.wrap(e);
    }
  }

  async canary(modelId: string): Promise<{ ok: boolean; error?: string; latency_ms: number }> {
    const t0 = Date.now();
    try {
      if (/veo/i.test(modelId)) {
        // Video models have no cheap call; probe model metadata instead.
        await this.ai.models.get({ model: modelId });
      } else {
        await this.ai.models.generateContent({ model: modelId, contents: "ping", config: { maxOutputTokens: 5 } });
      }
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latency_ms: Date.now() - t0 };
    }
  }
}
