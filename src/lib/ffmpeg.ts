import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";

const execFile = promisify(execFileCb);

export async function runFfmpeg(args: string[], cwd?: string): Promise<void> {
  try {
    await execFile("ffmpeg", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`ffmpeg failed: ${err.stderr ?? err.message}`);
  }
}

export async function runFfprobeJson(file: string): Promise<FfprobeResult> {
  const { stdout } = await execFile("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  return JSON.parse(stdout) as FfprobeResult;
}

export interface FfprobeResult {
  format?: { duration?: string; bit_rate?: string };
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    codec_name?: string;
    sample_rate?: string;
  }[];
}

export function spawnFfmpeg(args: string[]) {
  return spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
}
