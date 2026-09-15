/**
 * Generates the 18 designed CTA background PNGs (§19.8): /src/data/cta/{dialect}/{ratio}.png.
 * A brand gradient with a soft vignette and a channel-coloured rule. Replace with agency art
 * any time — the engine only requires the file to exist at the canvas size.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const CANVAS = { "16:9": { w: 1920, h: 1080 }, "9:16": { w: 1080, h: 1920 }, "1:1": { w: 1080, h: 1080 } } as const;
const CHANNEL: Record<string, string> = { hry: "#C9A227", raj: "#D1742F", bho: "#2E9E5B", guj: "#3D7EFF", mar: "#C2453F", ben: "#8A5CF6" };

async function main() {
  for (const [dialect, accent] of Object.entries(CHANNEL)) {
    for (const [ratio, c] of Object.entries(CANVAS)) {
      const ruleY = Math.round(c.h * 0.86);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.w}" height="${c.h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#232328"/><stop offset="0.6" stop-color="#141416"/><stop offset="1" stop-color="#0B0B0D"/></linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="${accent}" stop-opacity="0.18"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#v)"/>
  <rect x="${Math.round(c.w * 0.3)}" y="${ruleY}" width="${Math.round(c.w * 0.4)}" height="6" rx="3" fill="${accent}" fill-opacity="0.9"/>
</svg>`;
      const out = path.resolve(process.cwd(), "src/data/cta", dialect, `${ratio.replace(":", "x")}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(out);
      console.log("wrote", path.relative(process.cwd(), out));
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
