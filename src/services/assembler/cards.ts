import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import type { DialectPack, Ratio } from "@/domain";
import { RATIO_CANVAS, CTA_DEST } from "@/domain";

function fontFile(name: string): string {
  const map: Record<string, string> = {
    "NotoSansDevanagari-Bold": path.resolve(process.cwd(), "src/data/fonts/NotoSansDevanagari-Bold.ttf"),
    "NotoSansBengali-Bold": path.resolve(process.cwd(), "src/data/fonts/NotoSansBengali-Bold.ttf"),
  };
  return map[name] ?? path.resolve(process.cwd(), "src/data/fonts/NotoSans-Bold.ttf");
}

function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

export async function renderCaptionCard(args: {
  text: string;
  pack: DialectPack;
  ratio: Ratio;
  destPath: string;
}): Promise<string> {
  const box =
    args.ratio === "9:16"
      ? { w: 1080, h: 560 }
      : args.ratio === "1:1"
        ? { w: 1080, h: 252 }
        : { w: 640, h: 1080 };
  const size =
    args.ratio === "9:16"
      ? args.pack.typography.caption_size_916
      : args.ratio === "1:1"
        ? args.pack.typography.caption_size_11
        : args.pack.typography.caption_size_169;
  const lines = wrap(args.text, args.ratio === "16:9" ? 12 : 16);
  const lineH = Math.round(size * args.pack.typography.line_height);
  const startY = Math.round((box.h - lines.length * lineH) / 2) + size;
  const font = fontFile(args.pack.typography.caption_font).replace(/\\/g, "/");
  const texts = lines
    .map((ln, i) => {
      const y = startY + i * lineH;
      const escaped = ln.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      return `<text x="${box.w / 2}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="${size}" fill="#F4F4F5">${escaped}</text>`;
    })
    .join("");
  const svg = `<svg width="${box.w}" height="${box.h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#1C1C20"/>
    <style>@font-face { font-family: 'Caption'; src: url('file://${font}'); }</style>
    ${texts.replace(/font-family="sans-serif"/g, "font-family='Caption, sans-serif'")}
  </svg>`;
  fs.mkdirSync(path.dirname(args.destPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(args.destPath);
  return args.destPath;
}

export async function renderCtaCard(args: {
  titleNative: string;
  template: string;
  pack: DialectPack;
  ratio: Ratio;
  destPath: string;
}): Promise<string> {
  const dest = CTA_DEST[args.ratio];
  const canvas = RATIO_CANVAS[args.ratio];
  void canvas;
  const text = args.template.replace("{title}", args.titleNative);
  const font = fontFile(args.pack.typography.caption_font).replace(/\\/g, "/");
  const size = args.ratio === "9:16" ? 56 : args.ratio === "1:1" ? 42 : 40;
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const svg = `<svg width="${dest.w}" height="${dest.h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" rx="8" fill="#3D7EFF"/>
    <style>@font-face { font-family: 'Cta'; src: url('file://${font}'); }</style>
    <text x="${dest.w / 2}" y="${Math.round(dest.h / 2 + size / 3)}" text-anchor="middle"
      font-family="Cta, sans-serif" font-size="${size}" fill="#FFFFFF">${escaped}</text>
  </svg>`;
  fs.mkdirSync(path.dirname(args.destPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(args.destPath);
  return args.destPath;
}

/** Base CTA plate per dialect/ratio — designed asset, no model. */
export async function writeCtaPlate(dialect: string, ratio: Ratio, destPath: string) {
  const dest = CTA_DEST[ratio];
  const svg = `<svg width="${dest.w}" height="${dest.h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" rx="8" fill="#3D7EFF"/>
    <text x="24" y="32" font-size="18" fill="#fff" font-family="sans-serif">STAGE · ${dialect} · ${ratio}</text>
  </svg>`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(destPath);
}
