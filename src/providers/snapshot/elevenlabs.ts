import { spawn } from "node:child_process";
import type { ElevenLabsPort } from "../ports";

function ffmpegToBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args, "-f", "mp3", "pipe:1"]);
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.stderr.on("data", (b: Buffer) => (err += b.toString()));
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`snapshot audio: ffmpeg exited ${code}: ${err.slice(-300)}`))));
    child.on("error", reject);
  });
}

/** Offline stand-in: a spoken-rhythm tone for VO, a soft pad for music. Zero cost. */
export class SnapshotElevenLabs implements ElevenLabsPort {
  readonly mode = "snapshot" as const;

  async tts(args: { text: string }) {
    const words = args.text.split(/\s+/).filter(Boolean).length;
    const ms = Math.max(600, Math.round((words / 2.4) * 1000));
    const d = (ms / 1000).toFixed(3);
    // a low syllabic pulse so ducking and D6 silence checks exercise real audio
    const mp3 = await ffmpegToBuffer(["-f", "lavfi", "-i", `sine=frequency=220:sample_rate=44100:duration=${d}`, "-af", "tremolo=f=4:d=0.7,volume=0.5", "-c:a", "libmp3lame", "-b:a", "128k"]);
    return { mp3, ms, cost_inr: 0 };
  }

  async music(args: { duration_ms: number }) {
    const d = (Math.max(1000, args.duration_ms) / 1000).toFixed(3);
    const mp3 = await ffmpegToBuffer(["-f", "lavfi", "-i", `sine=frequency=110:sample_rate=44100:duration=${d}`, "-f", "lavfi", "-i", `sine=frequency=165:sample_rate=44100:duration=${d}`, "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0,volume=0.25[a]", "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "128k"]);
    return { mp3, cost_inr: 0 };
  }

  async listVoices() {
    return [
      { voice_id: "snapshot-voice-m", name: "Snapshot Male (offline)", labels: { mode: "snapshot" } },
      { voice_id: "snapshot-voice-f", name: "Snapshot Female (offline)", labels: { mode: "snapshot" } },
    ];
  }

  async ping() {
    return { ok: true };
  }
}
