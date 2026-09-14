import fs from "node:fs";
import path from "node:path";
import { runFfmpeg } from "@/lib/ffmpeg";

export async function ensureSourceMedia(args: {
  titleId: string;
  videoUrl: string | null;
  posterUrl: string | null;
  durationS?: number;
}): Promise<string> {
  const dest = path.resolve(process.cwd(), "data/media", `${args.titleId}.mp4`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 80_000) return dest;

  const seconds = Math.min(90, Math.max(25, Math.round(args.durationS ?? 40)));
  if (args.videoUrl) {
    try {
      await runFfmpeg([
        "-y",
        "-ss",
        "4",
        "-t",
        String(seconds),
        "-i",
        args.videoUrl,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-shortest",
        dest,
      ]);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 80_000) return dest;
    } catch (e) {
      console.warn("source video fetch failed, using poster stand-in", (e as Error).message.slice(0, 180));
    }
  }

  let poster = path.resolve(process.cwd(), "data/media", `${args.titleId}.poster.jpg`);
  if (args.posterUrl) {
    try {
      const res = await fetch(args.posterUrl, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        fs.writeFileSync(poster, Buffer.from(await res.arrayBuffer()));
      }
    } catch {
      poster = "";
    }
  }
  const input = poster && fs.existsSync(poster)
    ? ["-loop", "1", "-t", String(seconds), "-i", poster]
    : ["-f", "lavfi", "-i", `color=c=0x1c1c20:s=1920x1080:r=30:d=${seconds}`];
  await runFfmpeg([
    "-y",
    ...input,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:sample_rate=48000:duration=${seconds}`,
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x141416,fps=30",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    dest,
  ]);
  return dest;
}
