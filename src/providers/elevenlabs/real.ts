import { env } from "@/config/env";
import { models, round2 } from "@/config/models";
import { ProviderUnavailable } from "@/domain";
import type { ElevenLabsPort } from "../ports";

const BASE = "https://api.elevenlabs.io/v1";

export class RealElevenLabs implements ElevenLabsPort {
  readonly mode = "real" as const;
  constructor(private readonly apiKey: string) {}

  private headers(extra: Record<string, string> = {}) {
    return { "xi-api-key": this.apiKey, ...extra };
  }

  private async fail(res: Response, what: string): Promise<never> {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new ProviderUnavailable("ElevenLabs", `${what}: rate limited`, "Retrying with backoff.");
    if (res.status >= 500) throw new ProviderUnavailable("ElevenLabs", `${what}: ${res.status}`);
    throw new Error(`ElevenLabs ${what}: ${res.status} ${body.slice(0, 300)}`);
  }

  async tts(args: Parameters<ElevenLabsPort["tts"]>[0]) {
    const res = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(args.voice_id)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", Accept: "audio/mpeg" }),
      body: JSON.stringify({
        text: args.text,
        model_id: args.model,
        language_code: args.language_code,
        voice_settings: {
          stability: args.settings.stability,
          similarity_boost: args.settings.similarity_boost,
          style: args.settings.style,
          speed: args.settings.speed,
          use_speaker_boost: true,
        },
      }),
    }).catch((e) => {
      throw new ProviderUnavailable("ElevenLabs", e instanceof Error ? e.message : String(e));
    });
    if (!res.ok) await this.fail(res, "tts");
    const mp3 = Buffer.from(await res.arrayBuffer());
    const ms = estimateMp3Ms(mp3);
    return { mp3, ms, cost_inr: round2((args.text.length / 1000) * models.pricing_usd_flat.elevenlabs_tts_per_1k_chars * env.INR_PER_USD) };
  }

  async music(args: Parameters<ElevenLabsPort["music"]>[0]) {
    const res = await fetch(`${BASE}/music?output_format=mp3_44100_128`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", Accept: "audio/mpeg" }),
      body: JSON.stringify({ prompt: args.brief, music_length_ms: Math.max(10_000, Math.min(300_000, args.duration_ms)), model_id: args.model }),
    }).catch((e) => {
      throw new ProviderUnavailable("ElevenLabs", e instanceof Error ? e.message : String(e));
    });
    if (!res.ok) await this.fail(res, "music");
    return { mp3: Buffer.from(await res.arrayBuffer()), cost_inr: round2(models.pricing_usd_flat.elevenlabs_music_per_call * env.INR_PER_USD) };
  }

  async listVoices() {
    const res = await fetch(`${BASE}/voices`, { headers: this.headers() });
    if (!res.ok) await this.fail(res, "voices");
    const j = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] };
    return j.voices.map((v) => ({ voice_id: v.voice_id, name: v.name, labels: v.labels ?? {} }));
  }

  async ping() {
    try {
      const res = await fetch(`${BASE}/user`, { headers: this.headers() });
      if (!res.ok) return { ok: false, error: `ElevenLabs /user returned ${res.status}${res.status === 401 ? " — check ELEVENLABS_API_KEY" : ""}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/** Rough duration from byte size at 128 kbps; exact duration is probed after storage. */
function estimateMp3Ms(buf: Buffer): number {
  return Math.round((buf.length * 8) / 128_000 * 1000);
}
