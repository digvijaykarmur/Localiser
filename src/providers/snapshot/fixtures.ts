import fs from "node:fs";
import path from "node:path";
import { SNAPSHOT_DIR } from "@/config/env";

export function snapshotPath(...parts: string[]): string {
  return path.join(SNAPSHOT_DIR, ...parts);
}

export function readJson<T>(rel: string, fallback: T): T {
  const p = snapshotPath(rel);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

export function snapshotExists(rel: string): boolean {
  return fs.existsSync(snapshotPath(rel));
}

/** Prompts carry their structured input as `INPUT\n{json}`; snapshot stubs read it back. */
export function extractInputJson<T = Record<string, unknown>>(text: string): T | null {
  const idx = text.indexOf("INPUT");
  const start = text.indexOf("{", idx < 0 ? 0 : idx);
  if (start < 0) return null;
  const end = text.lastIndexOf("}");
  if (end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
