import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { DATA_DIR, providerModes } from "@/config/env";
import { models } from "@/config/models";
import { db, schema, type AssetProvenance } from "@/db/client";
import {
  CAPTION_DOMINANT,
  nativeCaptionBox,
  renderCta,
  STACKED,
  type DialectPack,
  type EvidenceUnit,
  type FormatPolicy,
  type PromoPlan,
  type Ratio,
  type Recipe,
  type Script,
  type Title,
} from "@/domain";
import { ffmpeg, ffprobeJson } from "@/lib/ffmpeg";
import { hashInputs } from "@/lib/hash";
import { ids } from "@/lib/ids";
import { log } from "@/lib/log";
import { elevenlabs, keys, storage, vertex } from "@/providers";
import type { AssetRef } from "../composer/buildTimeline";
import type { CostMeter } from "../cost/meter";
import { fontPath } from "../dialects";
import { ensureMaster } from "../intelligence/ingest";
import { captionSize, ctaBackgroundPath, fallbackCtaBackground, renderCtaCard, renderTextCard } from "./cards";

const logger = log("assemble");

export interface AssembleContext {
  jobId: string;
  recipe: Recipe;
  title: Title;
  plans: Record<string, PromoPlan>; // by ratio
  script: Script;
  evidence: Map<string, EvidenceUnit>;
  pack: DialectPack;
  policy: FormatPolicy;
  meter: CostMeter;
}

export function rowToAssetRef(r: typeof schema.assets.$inferSelect): AssetRef {
  const meta = (r.provenance as AssetProvenance & { meta?: AssetRef["meta"] }).meta ?? {};
  return { id: r.id, kind: r.kind as AssetRef["kind"], ratio: r.ratio, duration_ms: r.durationMs, width: r.width, height: r.height, meta };
}

export async function loadAssets(jobId: string): Promise<{ refs: AssetRef[]; paths: Map<string, string>; rows: (typeof schema.assets.$inferSelect)[] }> {
  const rows = await db.query.assets.findMany({ where: eq(schema.assets.jobId, jobId) });
  const st = storage();
  const paths = new Map<string, string>();
  for (const r of rows) paths.set(r.id, await st.localPath(r.storageKey));
  return { refs: rows.map(rowToAssetRef), paths, rows };
}

/** S6 — produce every asset the Timelines will reference. Idempotent per (job, kind, ratio, input hash). */
export async function assemble(ctx: AssembleContext): Promise<{ assets: AssetRef[]; cost_inr: number }> {
  const st = storage();
  let cost = 0;
  const existing = await db.query.assets.findMany({ where: eq(schema.assets.jobId, ctx.jobId) });
  const have = new Map(existing.map((a) => [`${a.kind}|${a.ratio ?? ""}|${a.inputHash}`, a]));

  const persist = async (a: {
    kind: AssetRef["kind"];
    ratio: Ratio | null;
    inputHash: string;
    make: () => Promise<{ body: Buffer; contentType: string; ext: string; durationMs?: number | null; width?: number | null; height?: number | null }>;
    provenance: Omit<AssetProvenance, "input_hash">;
    meta: AssetRef["meta"];
    aiGenerated?: boolean;
  }): Promise<AssetRef> => {
    const key = `${a.kind}|${a.ratio ?? ""}|${a.inputHash}`;
    const hit = have.get(key);
    if (hit && (await st.exists(hit.storageKey))) return rowToAssetRef(hit);
    const made = await a.make();
    const id = ids.asset();
    const storageKey = keys.asset(ctx.jobId, a.kind, `${id}${a.ratio ? "_" + a.ratio.replace(":", "x") : ""}.${made.ext}`);
    await st.put(storageKey, made.body, made.contentType);
    let durationMs = made.durationMs ?? null;
    let width = made.width ?? null;
    let height = made.height ?? null;
    if (made.ext === "mp4" || made.ext === "mp3") {
      const probe = await ffprobeJson(await st.localPath(storageKey));
      durationMs = Math.round(Number(probe.format.duration ?? 0) * 1000);
      const v = probe.streams.find((s) => s.codec_type === "video");
      if (v) {
        width = v.width ?? null;
        height = v.height ?? null;
      }
    }
    const provenance: AssetProvenance & { meta: AssetRef["meta"] } = { ...a.provenance, input_hash: a.inputHash, meta: a.meta };
    const row = { id, jobId: ctx.jobId, kind: a.kind, ratio: a.ratio, storageKey, contentType: made.contentType, durationMs, width, height, provenance, inputHash: a.inputHash, aiGenerated: a.aiGenerated ?? false };
    await db.insert(schema.assets).values(row).onConflictDoNothing();
    const saved = await db.query.assets.findFirst({ where: and(eq(schema.assets.jobId, ctx.jobId), eq(schema.assets.kind, a.kind), eq(schema.assets.inputHash, a.inputHash)) });
    return rowToAssetRef(saved ?? (row as unknown as typeof schema.assets.$inferSelect));
  };

  const out: AssetRef[] = [];
  const plans = Object.values(ctx.plans);
  const ratios = Object.keys(ctx.plans) as Ratio[];
  const master = await ensureMaster(ctx.recipe.title_id);
  const font = fontPath(ctx.pack);

  // 1. source cuts — one per evidence unit used by any beat; length = longest beat using it
  const cutFor = new Map<string, number>();
  for (const p of plans) {
    const body = p.beats.filter((b) => b.role !== "CTA");
    const cta = p.beats.find((b) => b.role === "CTA");
    for (const b of body) {
      // without a music bed the last moment's audio carries under the CTA card (see buildTimeline)
      const tail = !ctx.policy.has_music && cta && b === body.at(-1) ? cta.duration_ms : 0;
      cutFor.set(b.evidence_ids[0]!, Math.max(cutFor.get(b.evidence_ids[0]!) ?? 0, b.duration_ms + tail));
    }
  }
  for (const [evId, dur] of cutFor) {
    const e = ctx.evidence.get(evId);
    if (!e) continue;
    const inMs = e.start_ms;
    const outMs = Math.min(e.end_ms, e.start_ms + dur);
    const inputHash = hashInputs("cut", ctx.recipe.title_id, inMs, outMs);
    out.push(
      await persist({
        kind: "source_cut",
        ratio: null,
        inputHash,
        meta: { evidence_id: evId },
        provenance: { provider: "ffmpeg", model: null, prompt_version: null, source_title_id: ctx.recipe.title_id, source_in_ms: inMs, source_out_ms: outMs },
        make: async () => {
          const tmp = path.join(await st.localPath(`jobs/${ctx.jobId}/tmp`), `cut_${inputHash}.mp4`);
          fs.mkdirSync(path.dirname(tmp), { recursive: true });
          await ffmpeg(["-ss", (inMs / 1000).toFixed(3), "-i", master, "-t", ((outMs - inMs) / 1000).toFixed(3), "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-af", "aresample=async=1", tmp]);
          const body = fs.readFileSync(tmp);
          fs.rmSync(tmp, { force: true });
          return { body, contentType: "video/mp4", ext: "mp4" };
        },
      }),
    );
  }

  // 2. stills for KENBURNS beats
  for (const p of plans)
    for (const b of p.beats) {
      if (b.treatment !== "KENBURNS_STILL") continue;
      const e = ctx.evidence.get(b.evidence_ids[0]!);
      if (!e) continue;
      const t = (e.start_ms + e.end_ms) / 2;
      const inputHash = hashInputs("still", ctx.recipe.title_id, t);
      out.push(
        await persist({
          kind: "still",
          ratio: null,
          inputHash,
          meta: { beat_index: b.index, evidence_id: e.id },
          provenance: { provider: "ffmpeg", model: null, prompt_version: null, source_title_id: ctx.recipe.title_id, source_in_ms: t, source_out_ms: t },
          make: async () => {
            const tmp = path.join(await st.localPath(`jobs/${ctx.jobId}/tmp`), `still_${inputHash}.png`);
            fs.mkdirSync(path.dirname(tmp), { recursive: true });
            await ffmpeg(["-ss", (t / 1000).toFixed(3), "-i", master, "-frames:v", "1", tmp]);
            const body = fs.readFileSync(tmp);
            fs.rmSync(tmp, { force: true });
            return { body, contentType: "image/png", ext: "png", width: 1920, height: 1080 };
          },
        }),
      );
    }

  // 3. VO per vo/presenter line
  if (ctx.policy.has_vo) {
    const el = await elevenlabs();
    for (const line of ctx.script.lines.filter((l) => l.role === "vo" || l.role === "presenter")) {
      const inputHash = hashInputs("vo", ctx.pack.voice, line.text_native, ctx.pack.version);
      const est = Math.max(0.5, (line.text_native.length / 1000) * 0.18 * 88);
      const key = `vo||${inputHash}`;
      if (!have.get(key)) await ctx.meter.reserve("elevenlabs.tts", est);
      out.push(
        await persist({
          kind: "vo",
          ratio: null,
          inputHash,
          meta: { beat_index: line.beat_index, line_id: line.id },
          provenance: { provider: el.mode === "real" ? "elevenlabs" : "snapshot", model: ctx.pack.voice.model, prompt_version: null },
          make: async () => {
            const r = await el.tts({ voice_id: ctx.pack.voice.voice_id || "snapshot-voice-m", model: ctx.pack.voice.model, text: line.text_native, settings: ctx.pack.voice.settings, language_code: ctx.pack.voice.language_code });
            cost += await charge(ctx.meter, "elevenlabs.tts", r.cost_inr);
            return { body: r.mp3, contentType: "audio/mpeg", ext: "mp3", durationMs: r.ms };
          },
        }),
      );
    }
  }

  // 4. music bed
  if (ctx.policy.has_music) {
    const el = await elevenlabs();
    const total = plans[0]!.total_duration_ms;
    const brief = ctx.recipe.music_brief ?? `${ctx.title.genre.join(", ") || "drama"} underscore, ${ctx.pack.name} regional flavour, tension building, no vocals, broadcast promo bed`;
    const inputHash = hashInputs("music", brief, total, models.music.model);
    if (!have.get(`music||${inputHash}`)) await ctx.meter.reserve("elevenlabs.music", 0.5 * 88);
    out.push(
      await persist({
        kind: "music",
        ratio: null,
        inputHash,
        meta: {},
        aiGenerated: el.mode === "real",
        provenance: { provider: el.mode === "real" ? "elevenlabs" : "snapshot", model: models.music.model, prompt_version: null },
        make: async () => {
          const r = await el.music({ model: models.music.model, brief, duration_ms: total + 2000 });
          cost += await charge(ctx.meter, "elevenlabs.music", r.cost_inr);
          return { body: r.mp3, contentType: "audio/mpeg", ext: "mp3", durationMs: total + 2000 };
        },
      }),
    );
  }

  // 5. caption cards per (caption line, ratio), sized to that ratio's layout for the beat's treatment
  for (const ratio of ratios) {
    const plan = ctx.plans[ratio]!;
    for (const line of ctx.script.lines.filter((l) => l.role === "caption")) {
      const beat = plan.beats.find((b) => b.index === line.beat_index);
      if (!beat || beat.role === "CTA") continue;
      const box = beat.treatment === "CAPTION_DOMINANT" || beat.treatment === "KENBURNS_STILL" ? CAPTION_DOMINANT[ratio].caption : beat.treatment === "STACKED" ? STACKED[ratio].caption : nativeCaptionBox(ratio);
      const backing = !(beat.treatment === "CAPTION_DOMINANT" || beat.treatment === "KENBURNS_STILL");
      const size = captionSize(ctx.pack, ratio);
      const inputHash = hashInputs("caption", line.text_native, ratio, box, size, ctx.pack.version, backing);
      out.push(
        await persist({
          kind: "caption_card",
          ratio,
          inputHash,
          meta: { beat_index: beat.index, line_id: line.id },
          provenance: { provider: "sharp", model: null, prompt_version: null },
          make: async () => ({
            body: await renderTextCard({ w: box.w, h: box.h, text: line.text_native, fontPath: font, fontSize: size, lineHeight: ctx.pack.typography.line_height, maxLines: 2, backing }),
            contentType: "image/png",
            ext: "png",
            width: box.w,
            height: box.h,
          }),
        }),
      );
    }

    // 6. CTA background + text card per ratio
    const ctaText = renderCta(ctx.pack.cta_templates[ctx.recipe.cta_variant] ?? ctx.pack.cta_templates.default!, ctx.title.name_native);
    const bgPath = ctaBackgroundPath(ctx.recipe.dialect, ratio);
    out.push(
      await persist({
        kind: "cta_bg",
        ratio,
        inputHash: hashInputs("cta_bg", ctx.recipe.dialect, ratio, bgPath ? fs.statSync(bgPath).size : 0),
        meta: {},
        provenance: { provider: "sharp", model: null, prompt_version: null },
        make: async () => ({ body: bgPath ? fs.readFileSync(bgPath) : await fallbackCtaBackground(ratio), contentType: "image/png", ext: "png" }),
      }),
    );
    out.push(
      await persist({
        kind: "cta_card",
        ratio,
        inputHash: hashInputs("cta_card", ctaText, ctx.title.name_native, ratio, ctx.pack.version),
        meta: {},
        provenance: { provider: "sharp", model: null, prompt_version: null },
        make: async () => {
          const r = await renderCtaCard({ ratio, titleNative: ctx.title.name_native, ctaText, pack: ctx.pack, fontPath: font });
          return { body: r.png, contentType: "image/png", ext: "png", width: r.w, height: r.h };
        },
      }),
    );
  }

  // 7. presenter (Split UGC) — generated once at 9:16 natively, ≤8s segments covering the body
  if (ctx.policy.has_presenter) {
    const v = await vertex();
    const body = plans[0]!.beats.filter((b) => b.role !== "CTA").reduce((s, b) => s + b.duration_ms, 0);
    const segments = Math.ceil(body / 8000);
    const segMs = Math.ceil(body / segments);
    const reference = personaReference(ctx.recipe.persona_id);
    const presenterLines = ctx.script.lines.filter((l) => l.role === "vo" || l.role === "presenter").map((l) => l.text_native).join(" ");
    for (let s = 0; s < segments; s++) {
      const prompt = presenterPrompt(ctx.pack, s, segments, presenterLines);
      const inputHash = hashInputs("presenter", prompt, segMs, models.video.model, reference ? reference.length : 0, ctx.recipe.seed);
      const est = 0.15 * (segMs / 1000) * 88;
      if (!have.get(`presenter|9:16|${inputHash}`)) await ctx.meter.reserve("vertex.veo", est);
      out.push(
        await persist({
          kind: "presenter",
          ratio: "9:16",
          inputHash,
          meta: { segment: s },
          aiGenerated: v.mode === "real",
          provenance: { provider: v.mode === "real" ? "vertex" : "snapshot", model: models.video.model, prompt_version: "presenter.v1" },
          make: async () => {
            const r = await v.video({ model: models.video.model, prompt, ratio: "9:16", duration_ms: segMs, reference: reference ?? undefined, meta: { stage: "presenter", prompt_version: "presenter.v1", recipe_id: ctx.recipe.id } });
            cost += await charge(ctx.meter, "vertex.veo", r.cost_inr);
            return { body: r.mp4, contentType: "video/mp4", ext: "mp4" };
          },
        }),
      );
    }
  }

  logger.info("assembled", { jobId: ctx.jobId, assets: out.length, cost });
  return { assets: out, cost_inr: cost };
}

async function charge(meter: CostMeter, item: string, amount: number): Promise<number> {
  if (amount > 0) await meter.charge(item, amount);
  return amount;
}

function personaReference(personaId: string | null): Buffer | null {
  if (!personaId) return null;
  const p = path.join(DATA_DIR, "personas", `${personaId}.png`);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

/** Fixed template — code-authored, never a model string. */
function presenterPrompt(pack: DialectPack, segment: number, segments: number, lines: string): string {
  return [
    `A friendly ${pack.name}-speaking presenter in their late twenties, head and shoulders, centred with generous headroom, talking directly to camera with animated expressions, in a warm plain indoor setting.`,
    `Vertical 9:16 framing. Natural lighting. No on-screen text, no captions, no logos, no hands covering the face.`,
    `The presenter is silently mouthing an enthusiastic promo (part ${segment + 1} of ${segments}) whose gist is: "${lines.slice(0, 200)}".`,
    `Consistent identity, clothing and background across all parts.`,
  ].join(" ");
}

export { sharp, providerModes };
