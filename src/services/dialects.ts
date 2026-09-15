import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { DATA_DIR } from "@/config/env";
import { db, schema } from "@/db/client";
import { bumpPackVersion, DialectCode, DialectPack, PromoError } from "@/domain";
import { ids } from "@/lib/ids";

const dir = path.join(DATA_DIR, "dialects");

export function loadPack(code: DialectCode): DialectPack {
  const p = path.join(dir, `${code}.json`);
  if (!fs.existsSync(p)) throw new PromoError("NOT_FOUND", `Dialect pack ${code} not found at ${p}`);
  return DialectPack.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}

export function allPacks(): DialectPack[] {
  return DialectCode.options.map(loadPack);
}

/** Load a specific historical version from dialect_versions (falls back to disk if absent). */
export async function loadPackVersion(code: DialectCode, version: string): Promise<DialectPack> {
  const row = await db.query.dialectVersions.findFirst({ where: and(eq(schema.dialectVersions.code, code), eq(schema.dialectVersions.version, version)) });
  if (row) return DialectPack.parse(row.pack);
  const disk = loadPack(code);
  if (disk.version === version) return disk;
  throw new PromoError("NOT_FOUND", `Dialect pack ${code}@${version} not found`, { recovery: "The recipe references a pack version that was never saved. Re-save the pack." });
}

/** Save writes the JSON file AND a dialect_versions row (§6 step 6). Version bumps automatically. */
export async function savePack(code: DialectCode, incoming: unknown, savedBy: string): Promise<DialectPack> {
  const parsed = DialectPack.parse(incoming);
  if (parsed.code !== code) throw new PromoError("VALIDATION", `Pack code ${parsed.code} does not match route ${code}`);
  const current = fs.existsSync(path.join(dir, `${code}.json`)) ? loadPack(code) : null;
  const version = current ? bumpPackVersion(current.version, code) : `${code}.v1`;
  const pack: DialectPack = { ...parsed, version };
  fs.writeFileSync(path.join(dir, `${code}.json`), JSON.stringify(pack, null, 2) + "\n");
  await db.insert(schema.dialectVersions).values({ id: ids.dialectVersion(), code, version, pack, savedBy }).onConflictDoNothing();
  return pack;
}

/** Ensure the on-disk pack version is recorded in dialect_versions (first-run bootstrap). */
export async function ensurePackVersionRecorded(code: DialectCode): Promise<DialectPack> {
  const pack = loadPack(code);
  await db.insert(schema.dialectVersions).values({ id: ids.dialectVersion(), code, version: pack.version, pack, savedBy: "bootstrap" }).onConflictDoNothing();
  return pack;
}

export async function packHistory(code: DialectCode) {
  return db.query.dialectVersions.findMany({ where: eq(schema.dialectVersions.code, code), orderBy: desc(schema.dialectVersions.createdAt), limit: 20 });
}

export function fontPath(pack: DialectPack): string {
  const p = path.join(DATA_DIR, "fonts", `${pack.typography.caption_font}.ttf`);
  if (fs.existsSync(p)) return p;
  const fallback = pack.script === "bengali" ? "NotoSansBengali-Bold" : pack.script === "gujarati" ? "NotoSansGujarati-Bold" : "NotoSansDevanagari-Bold";
  return path.join(DATA_DIR, "fonts", `${fallback}.ttf`);
}
