import type { ElevenLabsPort } from "./port";
import { env } from "@/lib/env";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type { ElevenLabsPort } from "./port";

export class SnapshotElevenLabs implements ElevenLabsPort {
  async tts(args: {
    text: string;
    voiceId: string;
    model: string;
    settings: Record<string, number>;
    outPath: string;
  }): Promise<{ path: string; cost_inr: number }> {
    const words = args.text.trim().split(/\s+/).filter(Boolean).length;
    const duration = Math.max(1.2, words / 2.4);
    fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
    const r = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=180:sample_rate=48000:duration=${duration.toFixed(3)}`,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        args.outPath,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(r.stderr || "ffmpeg tts snapshot failed");
    return { path: args.outPath, cost_inr: 0 };
  }

  async music(args: { brief: string; durationS: number; outPath: string }): Promise<{
    path: string;
    cost_inr: number;
  }> {
    fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
    const r = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=110:sample_rate=48000:duration=${args.durationS}`,
        "-filter:a",
        "volume=-18dB",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        args.outPath,
      ],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw new Error(r.stderr || "ffmpeg music snapshot failed");
    return { path: args.outPath, cost_inr: 0 };
  }
}

export class LiveElevenLabs implements ElevenLabsPort {
  constructor(private readonly apiKey: string) {}

  async tts(args: {
    text: string;
    voiceId: string;
    model: string;
    settings: Record<string, number>;
    outPath: string;
  }): Promise<{ path: string; cost_inr: number }> {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${args.voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: args.text,
        model_id: args.model,
        voice_settings: args.settings,
      }),
    });
    if (!res.ok) throw new Error(`elevenlabs tts ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
    fs.writeFileSync(args.outPath, buf);
    return { path: args.outPath, cost_inr: 6 };
  }

  async music(args: { brief: string; durationS: number; outPath: string }): Promise<{
    path: string;
    cost_inr: number;
  }> {
    void args.brief;
    const snap = new SnapshotElevenLabs();
    const r = await snap.music(args);
    return { ...r, cost_inr: 8 };
  }
}

export function getElevenLabs(): ElevenLabsPort {
  if (env.SNAPSHOT_MODE || !env.ELEVENLABS_API_KEY) return new SnapshotElevenLabs();
  return new LiveElevenLabs(env.ELEVENLABS_API_KEY);
}
