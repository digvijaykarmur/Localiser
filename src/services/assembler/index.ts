import path from "node:path";
import fs from "node:fs";
import {
  Timeline,
  Layer,
  AudioTrack,
  RATIO_CANVAS,
  CTA_DEST,
  type PromoPlan,
  type Recipe,
  type EvidenceUnit,
  type Script,
  type Title,
  type Ratio,
} from "@/domain";
import { getDialectPack, getFormat } from "@/lib/registry";
import { storage } from "@/providers/storage";
import { getElevenLabs, resolveElevenLabsModel, resolveElevenLabsVoiceId } from "@/providers/elevenlabs";
import { getVertex } from "@/providers/vertex";
import { costMeter } from "@/services/cost/meter";
import { runFfmpeg } from "@/lib/ffmpeg";
import { ratioFileToken } from "@/lib/hash";
import { buildTrackedCrop, staticCropBox } from "@/services/planner/tracked-crop";
import { renderCaptionCard, renderCtaCard } from "./cards";
import {
  captionDest,
  compositionUsesWholeFrame,
  kenburnsCrops,
  presenterDest,
  sourceDest,
} from "./layout";

export async function cutSourceClip(args: {
  sourcePath: string;
  startMs: number;
  endMs: number;
  outPath: string;
}) {
  fs.mkdirSync(path.dirname(args.outPath), { recursive: true });
  const t = ((args.endMs - args.startMs) / 1000).toFixed(3);
  await runFfmpeg([
    "-y",
    "-ss",
    (args.startMs / 1000).toFixed(3),
    "-i",
    args.sourcePath,
    "-t",
    t,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-avoid_negative_ts",
    "make_zero",
    args.outPath,
  ]);
}

export async function assembleRatio(args: {
  recipe: Recipe;
  plan: PromoPlan;
  script: Script | null;
  evidence: EvidenceUnit[];
  title: Title;
  sourcePath: string;
}): Promise<Timeline> {
  const { recipe, plan, script, evidence, title, sourcePath } = args;
  const ratio = plan.ratio;
  const canvas = RATIO_CANVAS[ratio];
  const pack = getDialectPack(recipe.dialect);
  const format = getFormat(recipe.format);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const layers: Layer[] = [];
  const audio: AudioTrack[] = [];
  let z = 0;

  layers.push(
    Layer.parse({
      id: "bg",
      z: z++,
      type: "solid",
      start_ms: 0,
      end_ms: plan.total_duration_ms,
      dest: { x: 0, y: 0, w: canvas.width, h: canvas.height },
      asset_id: null,
      source_in_ms: null,
      source_out_ms: null,
      src_crop: null,
      crop_keyframes: null,
      fill_color: "#141416",
      opacity: 1,
    }),
  );

  const window = recipe.source_window;
  const firstEid = plan.beats[0]?.evidence_ids[0];
  let cursor = window?.start_ms ?? (firstEid ? byId.get(firstEid)?.start_ms ?? 0 : 0);

  let scCutKey: string | null = null;
  if (recipe.format === "SC" && window && fs.existsSync(sourcePath)) {
    scCutKey = `cuts/${recipe.id}/sc_window.mp4`;
    await cutSourceClip({
      sourcePath,
      startMs: window.start_ms,
      endMs: window.end_ms,
      outPath: storage.abs(scCutKey),
    });
  }

  let presenterAsset: string | null = null;
  if (format.uses.presenter) {
    await costMeter.precheck(recipe.id, "vertex.veo", recipe.cost_envelope_inr);
    const outKey = `generated/${recipe.id}/${ratioFileToken(ratio)}/presenter.mp4`;
    const outPath = storage.abs(outKey);
    const vertex = getVertex();
    await vertex.generateVideo({
      prompt: `presenter for ${title.name_native}`,
      width: canvas.width,
      height: ratio === "9:16" ? 960 : ratio === "1:1" ? 472 : 400,
      durationMs: plan.total_duration_ms,
      recipeId: recipe.id,
      outPath,
    });
    await costMeter.charge(recipe.id, "vertex.veo", 0, recipe.cost_envelope_inr);
    presenterAsset = outKey;
    layers.push(
      Layer.parse({
        id: "presenter",
        z: z++,
        type: "generated_video",
        start_ms: 0,
        end_ms: plan.total_duration_ms,
        dest: presenterDest(ratio),
        asset_id: outKey,
        source_in_ms: 0,
        source_out_ms: plan.total_duration_ms,
        src_crop: null,
        crop_keyframes: null,
        fill_color: null,
        opacity: 1,
      }),
    );
  }

  for (const beat of plan.beats) {
    const eid = beat.evidence_ids[0]!;
    const unit = byId.get(eid);
    if (!unit) continue;
    const dest = sourceDest(beat.treatment, ratio);
    const srcStart = recipe.format === "SC" && window ? cursor : unit.start_ms;
    const srcEnd =
      recipe.format === "SC" && window
        ? cursor + beat.duration_ms
        : Math.min(unit.end_ms, unit.start_ms + beat.duration_ms);
    if (recipe.format === "SC") cursor = srcEnd;

    let cutKey: string;
    let sourceIn = 0;
    let sourceOut = beat.duration_ms;
    if (scCutKey && window) {
      cutKey = scCutKey;
      sourceIn = srcStart - window.start_ms;
      sourceOut = srcEnd - window.start_ms;
    } else {
      cutKey = `cuts/${recipe.id}/${eid}_${beat.index}.mp4`;
      const cutPath = storage.abs(cutKey);
      if (fs.existsSync(args.sourcePath)) {
        await cutSourceClip({
          sourcePath: args.sourcePath,
          startMs: srcStart,
          endMs: srcEnd,
          outPath: cutPath,
        });
      }
    }

    let src_crop = null;
    let crop_keyframes = null;
    if (!compositionUsesWholeFrame(beat.treatment)) {
      if (beat.treatment === "KENBURNS_STILL") {
        crop_keyframes = kenburnsCrops(unit, beat.duration_ms);
      } else if (beat.treatment === "TRACKED_CROP") {
        const tracked = buildTrackedCrop(unit, ratio);
        if ("keyframes" in tracked) crop_keyframes = tracked.keyframes;
        else src_crop = staticCropBox(unit, ratio);
      } else {
        src_crop = staticCropBox(unit, ratio);
      }
    }

    layers.push(
      Layer.parse({
        id: `beat_${beat.index}`,
        z: z++,
        type: "source_clip",
        start_ms: beat.start_ms,
        end_ms: beat.start_ms + beat.duration_ms,
        dest,
        asset_id: cutKey,
        source_in_ms: sourceIn,
        source_out_ms: sourceOut,
        src_crop,
        crop_keyframes,
        fill_color: null,
        opacity: 1,
      }),
    );

    const line = script?.lines.find((l) => l.beat_index === beat.index);
    const captionText =
      beat.caption_text ??
      line?.text ??
      (format.caption_mode === "burned_asr" ? unit.dialogue_native : null);
    if (captionText && beat.role !== "CTA") {
      const capBox = captionDest(ratio);
      if (capBox && (beat.treatment === "CAPTION_DOMINANT" || format.caption_mode === "authored_cards" || format.caption_mode === "burned_asr")) {
        const cardKey = `cards/${recipe.id}/${ratioFileToken(ratio)}/cap_${beat.index}.png`;
        await renderCaptionCard({
          text: captionText,
          pack,
          ratio,
          destPath: storage.abs(cardKey),
        });
        const capDest =
          beat.treatment === "CAPTION_DOMINANT" || ratio === "9:16" ? capBox : { x: capBox.x, y: capBox.y, w: capBox.w, h: capBox.h };
        if (
          capDest.x >= 0 &&
          capDest.y >= 0 &&
          capDest.x + capDest.w <= canvas.width &&
          capDest.y + capDest.h <= canvas.height
        ) {
          layers.push(
            Layer.parse({
              id: `cap_${beat.index}`,
              z: z++,
              type: "caption_card",
              start_ms: beat.start_ms,
              end_ms: beat.start_ms + beat.duration_ms,
              dest: capDest,
              asset_id: cardKey,
              source_in_ms: null,
              source_out_ms: null,
              src_crop: null,
              crop_keyframes: null,
              fill_color: null,
              opacity: 1,
            }),
          );
        }
      }
    }
  }

  const ctaBeat = plan.beats.find((b) => b.role === "CTA");
  const ctaStart = ctaBeat ? ctaBeat.start_ms : plan.total_duration_ms - 4000;
  const ctaKey = `cards/${recipe.id}/${ratioFileToken(ratio)}/cta.png`;
  const template = pack.cta_templates[recipe.cta_variant] ?? pack.cta_templates.default ?? "{title}";
  await renderCtaCard({
    titleNative: title.name_native,
    template,
    pack,
    ratio,
    destPath: storage.abs(ctaKey),
  });
  layers.push(
    Layer.parse({
      id: "cta",
      z: z++,
      type: "cta_card",
      start_ms: ctaStart,
      end_ms: plan.total_duration_ms,
      dest: CTA_DEST[ratio],
      asset_id: ctaKey,
      source_in_ms: null,
      source_out_ms: null,
      src_crop: null,
      crop_keyframes: null,
      fill_color: null,
      opacity: 1,
    }),
  );

  const usesMusic = format.uses.music === true || format.uses.music === "bed" || format.uses.music === "optional";
  if (usesMusic && recipe.music_brief) {
    const musicKey = `audio/${recipe.id}/music.mp3`;
    await costMeter.precheck(recipe.id, "elevenlabs.music", recipe.cost_envelope_inr);
    await getElevenLabs().music({
      brief: recipe.music_brief,
      durationS: recipe.duration_s,
      outPath: storage.abs(musicKey),
    });
    await costMeter.charge(recipe.id, "elevenlabs.music", 0, recipe.cost_envelope_inr);
    audio.push(
      AudioTrack.parse({
        id: "music",
        role: "music",
        asset_id: musicKey,
        start_ms: 0,
        source_in_ms: 0,
        source_out_ms: plan.total_duration_ms,
        gain_db: -12,
        duck_against: format.uses.vo ? "vo" : null,
        fade_in_ms: 200,
        fade_out_ms: 400,
      }),
    );
  }

  if (format.uses.vo && script) {
    const voTexts = script.lines.map((l) => l.text).join(" ");
    const voKey = `audio/${recipe.id}/vo.mp3`;
    await costMeter.precheck(recipe.id, "elevenlabs.tts", recipe.cost_envelope_inr);
    await getElevenLabs().tts({
      text: voTexts,
      voiceId: resolveElevenLabsVoiceId(pack.voice.voice_id),
      model: resolveElevenLabsModel(pack.voice.model),
      settings: pack.voice.settings,
      outPath: storage.abs(voKey),
    });
    await costMeter.charge(recipe.id, "elevenlabs.tts", 0, recipe.cost_envelope_inr);
    audio.push(
      AudioTrack.parse({
        id: "vo",
        role: "vo",
        asset_id: voKey,
        start_ms: 0,
        source_in_ms: 0,
        source_out_ms: plan.total_duration_ms - (ctaBeat?.duration_ms ?? 4000),
        gain_db: 0,
        duck_against: null,
        fade_in_ms: 0,
        fade_out_ms: 80,
      }),
    );
  }

  if (format.uses.source_audio === true || format.uses.source_audio === "ducked") {
    const firstCut = layers.find((l) => l.type === "source_clip");
    if (firstCut?.asset_id) {
      audio.push(
        AudioTrack.parse({
          id: "source",
          role: "source",
          asset_id: firstCut.asset_id,
          start_ms: 0,
          source_in_ms: 0,
          source_out_ms: plan.total_duration_ms,
          gain_db: format.uses.source_audio === "ducked" ? -8 : 0,
          duck_against: format.uses.vo ? "vo" : null,
          fade_in_ms: 0,
          fade_out_ms: 0,
        }),
      );
    }
  }

  void presenterAsset;

  return Timeline.parse({
    recipe_id: recipe.id,
    ratio,
    width: canvas.width,
    height: canvas.height,
    fps: 30,
    duration_ms: plan.total_duration_ms,
    layers,
    audio,
  });
}
