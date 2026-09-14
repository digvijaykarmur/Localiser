import { z } from "zod";
import { Ratio } from "./codes";

export const Box = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type Box = z.infer<typeof Box>;

export const CropKeyframe = z.object({
  t_ms: z.number().int(),
  box: Box,
});
export type CropKeyframe = z.infer<typeof CropKeyframe>;

export const Layer = z.object({
  id: z.string(),
  z: z.number().int(),
  type: z.enum([
    "source_clip",
    "generated_video",
    "image",
    "solid",
    "caption_card",
    "cta_card",
  ]),
  start_ms: z.number().int(),
  end_ms: z.number().int(),
  dest: Box,
  asset_id: z.string().nullable(),
  source_in_ms: z.number().int().nullable(),
  source_out_ms: z.number().int().nullable(),
  src_crop: Box.nullable(),
  crop_keyframes: z.array(CropKeyframe).nullable(),
  fill_color: z.string().nullable(),
  opacity: z.number().min(0).max(1).default(1),
});
export type Layer = z.infer<typeof Layer>;

export const AudioTrack = z.object({
  id: z.string(),
  role: z.enum(["source", "vo", "music", "sfx"]),
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
      if (
        l.dest.x < 0 ||
        l.dest.y < 0 ||
        l.dest.x + l.dest.w > t.width ||
        l.dest.y + l.dest.h > t.height
      ) {
        ctx.addIssue({ code: "custom", message: `layer ${l.id} outside canvas` });
      }
    }
  });
export type Timeline = z.infer<typeof Timeline>;
