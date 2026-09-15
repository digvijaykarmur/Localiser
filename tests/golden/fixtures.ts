import type { Timeline } from "@/domain";

/**
 * Three fixed Timelines (§24.2): one per ratio, covering static crop, tracked crop, overlays,
 * stacked composition and ducking. The generated arg arrays are snapshotted in *.golden.json.
 */
export const ASSETS = new Map<string, string>([
  ["cut_0", "/assets/cut_0.mp4"],
  ["cut_1", "/assets/cut_1.mp4"],
  ["cut_2", "/assets/cut_2.mp4"],
  ["cap_0", "/assets/cap_0.png"],
  ["cap_1", "/assets/cap_1.png"],
  ["cta_bg", "/assets/cta_bg.png"],
  ["cta_card", "/assets/cta_card.png"],
  ["vo_0", "/assets/vo_0.mp3"],
  ["vo_1", "/assets/vo_1.mp3"],
  ["music", "/assets/music.mp3"],
  ["presenter_0", "/assets/presenter_0.mp4"],
]);

const layer = (partial: Partial<Timeline["layers"][number]> & Pick<Timeline["layers"][number], "id" | "z" | "type" | "start_ms" | "end_ms" | "dest">): Timeline["layers"][number] => ({
  asset_id: null,
  source_in_ms: null,
  source_out_ms: null,
  src_crop: null,
  crop_keyframes: null,
  fill_color: null,
  opacity: 1,
  ...partial,
});

const audio = (partial: Partial<Timeline["audio"][number]> & Pick<Timeline["audio"][number], "id" | "role" | "asset_id" | "start_ms" | "source_in_ms" | "source_out_ms">): Timeline["audio"][number] => ({
  gain_db: 0,
  duck_against: null,
  fade_in_ms: 0,
  fade_out_ms: 0,
  ...partial,
});

/** 16:9 — NATIVE beats, caption overlay, CTA, source audio + VO + ducked music. */
export const T169: Timeline = {
  recipe_id: "rcp_golden",
  ratio: "16:9",
  width: 1920,
  height: 1080,
  fps: 30,
  duration_ms: 12000,
  layers: [
    layer({ id: "src_0", z: 10, type: "source_clip", start_ms: 0, end_ms: 3000, dest: { x: 0, y: 0, w: 1920, h: 1080 }, asset_id: "cut_0", source_in_ms: 0, source_out_ms: 3000 }),
    layer({ id: "src_1", z: 10, type: "source_clip", start_ms: 3000, end_ms: 8000, dest: { x: 0, y: 0, w: 1920, h: 1080 }, asset_id: "cut_1", source_in_ms: 0, source_out_ms: 4200 }),
    layer({ id: "cap_0", z: 20, type: "caption_card", start_ms: 0, end_ms: 3000, dest: { x: 96, y: 780, w: 1728, h: 192 }, asset_id: "cap_0" }),
    layer({ id: "cap_1", z: 20, type: "caption_card", start_ms: 3000, end_ms: 8000, dest: { x: 96, y: 780, w: 1728, h: 192 }, asset_id: "cap_1" }),
    layer({ id: "cta_bg_2", z: 30, type: "image", start_ms: 8000, end_ms: 12000, dest: { x: 0, y: 0, w: 1920, h: 1080 }, asset_id: "cta_bg" }),
    layer({ id: "cta_2", z: 40, type: "cta_card", start_ms: 8000, end_ms: 12000, dest: { x: 96, y: 54, w: 1728, h: 918 }, asset_id: "cta_card" }),
  ],
  audio: [
    audio({ id: "a_src_00", role: "source", asset_id: "cut_0", start_ms: 0, source_in_ms: 0, source_out_ms: 3000, gain_db: -9, duck_against: "a_vo_00", fade_in_ms: 40, fade_out_ms: 120 }),
    audio({ id: "a_src_01", role: "source", asset_id: "cut_1", start_ms: 3000, source_in_ms: 0, source_out_ms: 4200, gain_db: -9, duck_against: "a_vo_01", fade_in_ms: 40, fade_out_ms: 120 }),
    audio({ id: "a_vo_00", role: "vo", asset_id: "vo_0", start_ms: 120, source_in_ms: 0, source_out_ms: 2600, fade_out_ms: 60 }),
    audio({ id: "a_vo_01", role: "vo", asset_id: "vo_1", start_ms: 3120, source_in_ms: 0, source_out_ms: 4000, fade_out_ms: 60 }),
    audio({ id: "a_music", role: "music", asset_id: "music", start_ms: 0, source_in_ms: 0, source_out_ms: 12000, gain_db: -16, duck_against: "a_vo_00", fade_in_ms: 300, fade_out_ms: 900 }),
  ],
};

/** 9:16 — CAPTION_DOMINANT band (uncropped 16:9 inside), one TRACKED_CROP beat, CTA. */
export const T916: Timeline = {
  recipe_id: "rcp_golden",
  ratio: "9:16",
  width: 1080,
  height: 1920,
  fps: 30,
  duration_ms: 10000,
  layers: [
    layer({
      id: "src_0",
      z: 10,
      type: "source_clip",
      start_ms: 0,
      end_ms: 3000,
      dest: { x: 0, y: 0, w: 1080, h: 1920 },
      asset_id: "cut_0",
      source_in_ms: 0,
      source_out_ms: 3000,
      crop_keyframes: [
        { t_ms: 0, box: { x: 200, y: 0, w: 608, h: 1080 } },
        { t_ms: 1000, box: { x: 200, y: 0, w: 608, h: 1080 } },
        { t_ms: 2500, box: { x: 320, y: 0, w: 608, h: 1080 } },
        { t_ms: 3000, box: { x: 320, y: 0, w: 608, h: 1080 } },
      ],
    }),
    layer({ id: "src_1", z: 10, type: "source_clip", start_ms: 3000, end_ms: 6000, dest: { x: 0, y: 220, w: 1080, h: 608 }, asset_id: "cut_1", source_in_ms: 0, source_out_ms: 3000 }),
    layer({ id: "cap_1", z: 20, type: "caption_card", start_ms: 3000, end_ms: 6000, dest: { x: 60, y: 828, w: 960, h: 560 }, asset_id: "cap_1" }),
    layer({ id: "cta_bg_2", z: 30, type: "image", start_ms: 6000, end_ms: 10000, dest: { x: 0, y: 0, w: 1080, h: 1920 }, asset_id: "cta_bg" }),
    layer({ id: "cta_2", z: 40, type: "cta_card", start_ms: 6000, end_ms: 10000, dest: { x: 60, y: 220, w: 960, h: 1354 }, asset_id: "cta_card" }),
  ],
  audio: [
    audio({ id: "a_src_00", role: "source", asset_id: "cut_0", start_ms: 0, source_in_ms: 0, source_out_ms: 3000, fade_in_ms: 40, fade_out_ms: 120 }),
    audio({ id: "a_src_01", role: "source", asset_id: "cut_1", start_ms: 3000, source_in_ms: 0, source_out_ms: 3000, fade_in_ms: 40, fade_out_ms: 120 }),
  ],
};

/** 1:1 — STACKED presenter over uncropped source, STATIC_CROP beat, VO ducking music, no source audio. */
export const T11: Timeline = {
  recipe_id: "rcp_golden",
  ratio: "1:1",
  width: 1080,
  height: 1080,
  fps: 30,
  duration_ms: 9000,
  layers: [
    layer({ id: "pres_0_0", z: 10, type: "generated_video", start_ms: 0, end_ms: 4000, dest: { x: 0, y: 0, w: 1080, h: 412 }, asset_id: "presenter_0", source_in_ms: 0, source_out_ms: 4000, src_crop: { x: 0, y: 210, w: 1080, h: 732 } }),
    layer({ id: "src_0", z: 10, type: "source_clip", start_ms: 0, end_ms: 4000, dest: { x: 0, y: 412, w: 1080, h: 608 }, asset_id: "cut_0", source_in_ms: 0, source_out_ms: 4000 }),
    layer({ id: "src_1", z: 10, type: "source_clip", start_ms: 4000, end_ms: 6000, dest: { x: 0, y: 0, w: 1080, h: 1080 }, asset_id: "cut_2", source_in_ms: 0, source_out_ms: 2000, src_crop: { x: 420, y: 0, w: 1080, h: 1080 }, opacity: 0.9 }),
    layer({ id: "cap_0", z: 20, type: "caption_card", start_ms: 0, end_ms: 4000, dest: { x: 60, y: 60, w: 960, h: 100 }, asset_id: "cap_0" }),
    layer({ id: "cta_2", z: 40, type: "cta_card", start_ms: 6000, end_ms: 9000, dest: { x: 60, y: 60, w: 960, h: 860 }, asset_id: "cta_card" }),
  ],
  audio: [
    audio({ id: "a_vo_00", role: "vo", asset_id: "vo_0", start_ms: 120, source_in_ms: 0, source_out_ms: 3500 }),
    audio({ id: "a_music", role: "music", asset_id: "music", start_ms: 0, source_in_ms: 0, source_out_ms: 9000, gain_db: -16, duck_against: "a_vo_00", fade_in_ms: 300, fade_out_ms: 900 }),
  ],
};
