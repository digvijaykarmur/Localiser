import { describe, expect, it } from "vitest";
import { Title } from "@/domain";
import { intelligenceFromLive, fitEvidenceToMedia } from "@/services/intelligence/live";

const title = Title.parse({
  id: "jalebi-har-s01e03",
  name: "Jalebi — Ghar Ka Kiraya",
  name_native: "Jalebi — Ghar Ka Kiraya",
  dialect: "hry",
  synopsis: "Family rent drama.",
  runtime_ms: 1_253_000,
  spoiler_boundary_ms: 876_000,
  genre: ["drama"],
  artwork_url: null,
  deep_link: "stage://title/jalebi-har-s01e03",
});

describe("intelligenceFromLive", () => {
  it("builds angles from Antaryami scenes and shots", () => {
    const intel = intelligenceFromLive({
      title,
      scenes: [
        {
          scene_id: "scene_001",
          start_ms: 0,
          end_ms: 8000,
          frame_url: null,
          has_dialogue: false,
          label: "Opening Credits",
          summary: "Title card",
          spoiler: false,
          intensity: 0,
          characters: [],
        },
        {
          scene_id: "scene_002",
          start_ms: 8000,
          end_ms: 40000,
          frame_url: null,
          has_dialogue: true,
          label: "Rent fight",
          summary: "The family argues over rent.",
          spoiler: false,
          intensity: 8,
          characters: ["Ba", "Beta"],
          conflict: "interpersonal",
          quotable: "किराया कब देवे?",
        },
      ],
      shots: [
        {
          shot_id: "shot_0001",
          scene_id: "scene_001",
          start_ms: 0,
          end_ms: 3000,
          shot_scale: "WIDE",
          action: "logo",
          camera: "static",
          characters: [],
        },
        {
          shot_id: "shot_0010",
          scene_id: "scene_002",
          start_ms: 12000,
          end_ms: 16000,
          shot_scale: "CU",
          action: "Ba shouts about rent",
          camera: "handheld",
          characters: ["Ba"],
        },
        {
          shot_id: "shot_0011",
          scene_id: "scene_002",
          start_ms: 16000,
          end_ms: 20000,
          shot_scale: "TWO_SHOT",
          action: "Ba and Beta face off",
          camera: "static",
          characters: ["Ba", "Beta"],
        },
        {
          shot_id: "shot_0012",
          scene_id: "scene_002",
          start_ms: 20000,
          end_ms: 25000,
          shot_scale: "MCU",
          action: "Beta looks away",
          camera: "pan",
          characters: ["Beta"],
        },
      ],
    });
    expect(intel.angles.length).toBeGreaterThanOrEqual(2);
    expect(intel.evidence.length).toBeGreaterThanOrEqual(3);
    expect(intel.evidence.some((e) => e.shot_type === "CU")).toBe(true);
    expect(intel.evidence.some((e) => e.has_dialogue)).toBe(true);
    expect(intel.angles.every((a) => a.evidence_ids.length >= 2)).toBe(true);
  });

  it("remaps late-episode shot clocks onto a short local source", () => {
    const intel = intelligenceFromLive({
      title,
      scenes: [
        {
          scene_id: "scene_002",
          start_ms: 900_000,
          end_ms: 980_000,
          frame_url: null,
          has_dialogue: true,
          summary: "Rent fight",
          spoiler: false,
          intensity: 8,
          characters: ["Ba"],
        },
      ],
      shots: [
        {
          shot_id: "shot_a",
          scene_id: "scene_002",
          start_ms: 910_000,
          end_ms: 914_000,
          shot_scale: "CU",
          action: "Ba shouts",
          camera: "static",
          characters: ["Ba"],
        },
        {
          shot_id: "shot_b",
          scene_id: "scene_002",
          start_ms: 920_000,
          end_ms: 925_000,
          shot_scale: "MCU",
          action: "Beta looks away",
          camera: "static",
          characters: ["Beta"],
        },
      ],
    });
    const fitted = fitEvidenceToMedia(intel.evidence, 90_000);
    expect(fitted.every((e) => e.end_ms <= 90_000)).toBe(true);
    expect(fitted.some((e) => e.start_ms >= 5000 && e.start_ms < 25000)).toBe(true);
  });
});
