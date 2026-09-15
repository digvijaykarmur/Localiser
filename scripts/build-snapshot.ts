/**
 * Generates synthetic 1920×1080 masters for the snapshot titles so the whole pipeline
 * (frame extraction, cuts, crops, compositions, QC probes) runs offline.
 *
 * Each scene is a distinct colour with rectangles drawn where the fixture evidence places
 * subjects, so tracked crops visibly centre on the "subject". Audio is a per-scene tone.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(process.cwd(), "src/data/snapshots");

interface Scene { seq: number; start_ms: number; end_ms: number }
interface Box { x: number; y: number; w: number; h: number }
interface Ev { subject_boxes: Box[]; shot_type: string; usable: boolean }

const PALETTE = ["0x2b3a55", "0x4a2b3a", "0x2b4a3a", "0x5a4a2b", "0x3a2b5a", "0x2b5a5a", "0x5a2b2b", "0x3f3f2b", "0x2b2b5a", "0x5a3f2b", "0x2b5a3f", "0x4a4a4a", "0x3a3a6a", "0x6a3a3a", "0x101010"];

function buildTitle(titleId: string) {
  const scenes = JSON.parse(fs.readFileSync(path.join(ROOT, "titles", titleId, "scenes.json"), "utf8")) as Scene[];
  const evPath = path.join(ROOT, "titles", titleId, "evidence.json");
  const evidence = fs.existsSync(evPath) ? (JSON.parse(fs.readFileSync(evPath, "utf8")) as Ev[]) : [];
  const out = path.join(ROOT, "media", `${titleId}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const inputs: string[] = [];
  const filters: string[] = [];
  scenes.forEach((s, i) => {
    const d = ((s.end_ms - s.start_ms) / 1000).toFixed(3);
    const colour = PALETTE[i % PALETTE.length]!;
    inputs.push("-f", "lavfi", "-i", `color=c=${colour}:s=1920x1080:r=30:d=${d}`);
    inputs.push("-f", "lavfi", "-i", `sine=frequency=${180 + i * 23}:sample_rate=48000:duration=${d}`);
    const ev = evidence[i];
    const boxes = ev?.usable === false ? [] : ev?.subject_boxes ?? [{ x: 0.4, y: 0.2, w: 0.2, h: 0.6 }];
    const drawn = boxes
      .map((b, j) => {
        const shade = ["0xd9b38c", "0x8cb3d9", "0xb38cd9", "0x8cd9a6", "0xd98c8c"][j % 5];
        const drift = ev?.shot_type === "ACTION" ? "+40*sin(t*2)" : "";
        return `drawbox=x=${Math.round(b.x * 1920)}${drift}:y=${Math.round(b.y * 1080)}:w=${Math.round(b.w * 1920)}:h=${Math.round(b.h * 1080)}:color=${shade}@1:t=fill`;
      })
      .join(",");
    const label = `drawtext=text='${titleId} scene ${i}':fontcolor=white@0.6:fontsize=42:x=40:y=40`;
    filters.push(`[${i * 2}:v]${drawn ? drawn + "," : ""}${label},format=yuv420p[v${i}]`);
    filters.push(`[${i * 2 + 1}:a]volume=0.3[a${i}]`);
  });
  const concatIn = scenes.map((_, i) => `[v${i}][a${i}]`).join("");
  filters.push(`${concatIn}concat=n=${scenes.length}:v=1:a=1[vout][aout]`);

  const args = ["-hide_banner", "-nostdin", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-g", "30", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];
  const r = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) {
    console.error(r.stderr.toString().slice(-2000));
    throw new Error(`ffmpeg failed for ${titleId}`);
  }
  console.log(`built ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
}

export function buildSnapshotMasters(only?: string) {
  const titles = JSON.parse(fs.readFileSync(path.join(ROOT, "titles.json"), "utf8")) as { id: string }[];
  for (const t of titles) if (!only || only === t.id) buildTitle(t.id);
}

if (process.argv[1] && /build-snapshot\.ts$/.test(process.argv[1])) buildSnapshotMasters(process.argv[2]);
