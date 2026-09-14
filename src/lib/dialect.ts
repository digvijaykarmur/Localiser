import { DialectCode, type DialectCode as Dialect } from "@/domain/codes";

const ALIASES: Record<string, Dialect> = {
  har: "hry",
  hry: "hry",
  hariyanvi: "hry",
  haryanvi: "hry",
  raj: "raj",
  rajasthani: "raj",
  bho: "bho",
  bhojpuri: "bho",
  guj: "guj",
  gujarati: "guj",
  mar: "mar",
  marathi: "mar",
  ben: "ben",
  bangla: "ben",
  bengali: "ben",
};

export function mapDialect(raw: string | null | undefined): Dialect | null {
  if (!raw) return null;
  const hit = ALIASES[raw.trim().toLowerCase()];
  if (hit) return hit;
  const parsed = DialectCode.safeParse(raw.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

export function dialectAliases(code: string): string[] {
  const mapped = mapDialect(code) ?? code;
  return Object.entries(ALIASES)
    .filter(([, v]) => v === mapped)
    .map(([k]) => k)
    .concat(mapped);
}
