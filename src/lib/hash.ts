import { createHash, randomBytes } from "node:crypto";

export function sha256(...parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function ratioFileToken(ratio: string): string {
  return ratio.replace(":", "x");
}
