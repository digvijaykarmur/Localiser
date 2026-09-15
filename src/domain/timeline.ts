import { z } from "zod";
import { Ratio } from "./primitives";

export const Box = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type Box = z.infer<typeof Box>;

export const CropKeyframe = z.object({ t_ms: z.number().int(), box: Box });
export type CropKeyframe = z.infer<typeof CropKeyframe>;

export const LayerType = z.enum(["source_clip", "generated_video", "image", "solid", "caption_card", "cta_card"]);
export type LayerType = z.infer<typeof LayerType>;

export const Layer = z.object({
  id: z.string(),
  z: z.number().int(),
  type: LayerType,
  start_ms: z.number().int(),
  end_ms: z.number().int(),
  dest: Box,
  asset_id: z.string().nullable(),
  source_in_ms: z.number().int().nullable(),
  source_out_ms: z.number().int().nullable(),
  src_crop: Box.nullable(),
  crop_keyframes: z.array(CropKeyframe).nullable(),
  fill_color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .nullable(),
  opacity: z.number().min(0).max(1).default(1),
});
export type Layer = z.infer<typeof Layer>;

export const AudioRole = z.enum(["source", "vo", "music", "sfx"]);

export const AudioTrack = z.object({
  id: z.string(),
  role: AudioRole,
  asset_id: z.string(),
  start_ms: z.number().int(),
  source_in_ms: z.number().int(),
  source_out_ms: z.number().int(),
  gain_db: z.number(),
  duck_against: z.string().nullable(),
  fade_in_ms: z.number().int().default(0),
  fade_out_ms: z.number().int().default(0),
});
export type AudioTrack = z.infer<typeof AudioTrack>;

export const Timeline = z
  .object({
    recipe_id: z.string(),
    ratio: Ratio,
    width: z.number().int(),
    height: z.number().int(),
    fps: z.literal(30),
    duration_ms: z.number().int(),
    layers: z.array(Layer),
    audio: z.array(AudioTrack),
  })
  .superRefine((t, ctx) => {
    for (const l of t.layers) {
      const { x, y, w, h } = l.dest;
      if (x < 0 || y < 0 || x + w > t.width || y + h > t.height)
        ctx.addIssue({ code: "custom", message: `layer ${l.id} outside canvas` });
      if (l.crop_keyframes && l.src_crop)
        ctx.addIssue({ code: "custom", message: `layer ${l.id} has both static and tracked crop` });
    }
    if (!t.audio.length) ctx.addIssue({ code: "custom", message: "no audio tracks" });
  });
export type Timeline = z.infer<typeof Timeline>;

export const TEXT_LAYER_TYPES: ReadonlySet<LayerType> = new Set(["caption_card", "cta_card"]);
