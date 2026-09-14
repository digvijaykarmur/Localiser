import fs from "node:fs";
import path from "node:path";
import { timelineToFiltergraph } from "./filtergraph";
import type { Timeline } from "@/domain";
import { storage } from "@/providers/storage";
import { runFfmpeg } from "@/lib/ffmpeg";

export async function composeTimeline(args: {
  timeline: Timeline;
  outKey: string;
}): Promise<string> {
  const outPath = storage.abs(args.outKey);
  const partial = `${outPath}.partial`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const { args: ff } = timelineToFiltergraph(args.timeline, (id) => storage.abs(id));
  const full = [...ff, "-f", "mp4", partial];
  try {
    await runFfmpeg(full);
    fs.renameSync(partial, outPath);
  } catch (e) {
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
    throw e;
  }
  return outPath;
}

export function cleanPartials(root: string) {
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith(".partial")) fs.unlinkSync(p);
    }
  };
  walk(root);
}
