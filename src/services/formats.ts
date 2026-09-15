import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/config/env";
import { FormatPolicy, type FormatCode } from "@/domain";

const cache = new Map<FormatCode, FormatPolicy>();

export function loadFormat(code: FormatCode): FormatPolicy {
  const hit = cache.get(code);
  if (hit) return hit;
  const p = path.join(DATA_DIR, "formats", `${code}.json`);
  const policy = FormatPolicy.parse(JSON.parse(fs.readFileSync(p, "utf8")));
  cache.set(code, policy);
  return policy;
}

export function allFormats(): FormatPolicy[] {
  return (["SC", "CP", "SU"] as FormatCode[]).map(loadFormat);
}
