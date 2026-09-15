import fs from "node:fs";
import path from "node:path";
import { STORAGE_ROOT_ABS } from "@/config/env";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp3": "audio/mpeg", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };

/** Serves files under STORAGE_ROOT (fs driver) with Range support so the tri-ratio players can seek. */
export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const rel = params.path.join("/");
  const abs = path.resolve(STORAGE_ROOT_ABS, rel);
  if (!abs.startsWith(STORAGE_ROOT_ABS) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response("not found", { status: 404 });
  const stat = fs.statSync(abs);
  const type = TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60" };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    headers["Content-Length"] = String(end - start + 1);
    const stream = fs.createReadStream(abs, { start, end });
    return new Response(stream as unknown as ReadableStream, { status: 206, headers });
  }
  headers["Content-Length"] = String(stat.size);
  return new Response(fs.createReadStream(abs) as unknown as ReadableStream, { status: 200, headers });
}
