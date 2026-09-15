import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/config/env";

/** Serves the pack fonts so the UI renders Devanagari/Bengali with the same faces the cards use (§28.2). */
export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const name = params.name.replace(/[^A-Za-z0-9._-]/g, "");
  const abs = path.join(DATA_DIR, "fonts", name);
  if (!name.endsWith(".ttf") || !fs.existsSync(abs)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(abs), { headers: { "Content-Type": "font/ttf", "Cache-Control": "public, max-age=31536000, immutable" } });
}
