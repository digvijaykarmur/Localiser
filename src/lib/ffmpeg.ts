import { spawn } from "node:child_process";
import { PromoError } from "@/domain/errors";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(bin: string, args: string[], opts: { cwd?: string; input?: Buffer; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new PromoError("RENDER_FAILURE", `${bin} timed out after ${opts.timeoutMs}ms`, { detail: { args } }));
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        reject(
          new PromoError("MISSING_BINARY", `${bin} is not installed.`, {
            recovery: `Install it: sudo apt-get install -y ${bin === "ffprobe" ? "ffmpeg" : bin}  (macOS: brew install ffmpeg)`,
          }),
        );
      else reject(e);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (opts.input) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function ffmpeg(args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  const r = await run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args], { timeoutMs: opts.timeoutMs ?? 600_000 });
  if (r.code !== 0) {
    throw new PromoError("RENDER_FAILURE", `ffmpeg exited ${r.code}`, {
      detail: { stderr: r.stderr.slice(-4000), args },
      recovery: "Fix the Timeline and retry from COMPOSE — free.",
    });
  }
  return r;
}

export async function ffprobeJson(file: string): Promise<ProbeResult> {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.code !== 0) throw new PromoError("RENDER_FAILURE", `ffprobe exited ${r.code}`, { detail: { stderr: r.stderr.slice(-2000), file } });
  return JSON.parse(r.stdout) as ProbeResult;
}

export interface ProbeStream {
  codec_type: "video" | "audio" | string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}
export interface ProbeResult {
  streams: ProbeStream[];
  format: { duration?: string; tags?: Record<string, string>; format_name?: string };
}

export function parseFps(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return n ?? 0;
  return n / d;
}

export async function binaryStatus(): Promise<{ ffmpeg: string | null; ffprobe: string | null }> {
  const v = async (bin: string) => {
    try {
      const r = await run(bin, ["-version"]);
      return r.code === 0 ? (r.stdout.split("\n")[0] ?? bin) : null;
    } catch {
      return null;
    }
  };
  return { ffmpeg: await v("ffmpeg"), ffprobe: await v("ffprobe") };
}
