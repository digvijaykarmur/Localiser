import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeCtaPlate } from "@/services/assembler/cards";
import type { Ratio } from "@/domain";

const DIALECTS = ["raj", "hry", "bho", "guj", "mar", "ben"] as const;
const RATIOS: Ratio[] = ["16:9", "9:16", "1:1"];

function sh(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `${cmd} failed`);
}

async function ctaPlates() {
  for (const d of DIALECTS) {
    for (const ratio of RATIOS) {
      const dest = path.resolve(process.cwd(), "src/data/cta", d, `${ratio.replace(":", "x")}.png`);
      await writeCtaPlate(d, ratio, dest);
    }
  }
}

function writeAntryami() {
  const titles = [
    {
      id: "ttl_hry_01",
      name: "Khet Ke Log",
      name_native: "खेत के लोग",
      dialect: "hry",
      synopsis: "A Haryanvi family holds a farm together when a land deal turns sour.",
      runtime_ms: 2_400_000,
      spoiler_boundary_ms: 1_440_000,
      genre: ["drama", "family"],
      artwork_url: null,
      deep_link: "stage://title/ttl_hry_01",
    },
    {
      id: "ttl_raj_01",
      name: "Thar Ki Dhun",
      name_native: "थार की धुन",
      dialect: "raj",
      synopsis: "Two musicians cross the desert with a secret song.",
      runtime_ms: 2_100_000,
      spoiler_boundary_ms: 1_260_000,
      genre: ["drama", "music"],
      artwork_url: null,
      deep_link: "stage://title/ttl_raj_01",
    },
  ];
  const root = path.resolve(process.cwd(), "data/snapshots/antryami");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "titles.json"), JSON.stringify(titles, null, 2));
  for (const t of titles) {
    fs.mkdirSync(path.join(root, "titles", t.id), { recursive: true });
    fs.writeFileSync(path.join(root, "titles", `${t.id}.json`), JSON.stringify(t, null, 2));
  }
  const scenes = [
    { scene_id: "sc_hry_01", start_ms: 0, end_ms: 5000, frame_url: null, has_dialogue: false },
    { scene_id: "sc_hry_02", start_ms: 5000, end_ms: 10000, frame_url: null, has_dialogue: true },
    { scene_id: "sc_hry_03", start_ms: 10000, end_ms: 15000, frame_url: null, has_dialogue: true },
    { scene_id: "sc_hry_04", start_ms: 15000, end_ms: 20000, frame_url: null, has_dialogue: false },
    { scene_id: "sc_hry_05", start_ms: 20000, end_ms: 25000, frame_url: null, has_dialogue: true },
    { scene_id: "sc_hry_06", start_ms: 25000, end_ms: 32000, frame_url: null, has_dialogue: false },
    { scene_id: "sc_hry_07", start_ms: 32000, end_ms: 40000, frame_url: null, has_dialogue: false },
  ];
  fs.writeFileSync(
    path.join(root, "titles", "ttl_hry_01", "scenes.json"),
    JSON.stringify(scenes, null, 2),
  );
  fs.writeFileSync(
    path.join(root, "titles", "ttl_raj_01", "scenes.json"),
    JSON.stringify(
      scenes.map((s) => ({ ...s, scene_id: s.scene_id.replace("hry", "raj") })),
      null,
      2,
    ),
  );
}

function box(x: number, y: number, w: number, h: number, speaking: boolean, label: string) {
  return { x, y, w, h, is_speaking: speaking, label };
}

function writeIntelligence() {
  const evidence = [
    {
      id: "ev_ttl_hry_01_001",
      title_id: "ttl_hry_01",
      start_ms: 0,
      end_ms: 5000,
      description: "A man's face fills the frame, eyes tight, breathing hard.",
      shot_type: "ECU",
      subject_count: 1,
      subject_boxes: [box(0.38, 0.22, 0.22, 0.5, true, "man in dusty shirt")],
      motion: "low",
      emotion: ["tension"],
      intensity: 6,
      has_dialogue: false,
      dialogue_native: null,
      dialogue_translit: null,
      is_spoiler: false,
      usable: true,
      unusable_reason: null,
      croppable_11: true,
      croppable_916: true,
      crop_note: null,
    },
    {
      id: "ev_ttl_hry_01_002",
      title_id: "ttl_hry_01",
      start_ms: 5000,
      end_ms: 10000,
      description: "A man and a woman sit across a wooden table arguing over papers.",
      shot_type: "TWO_SHOT",
      subject_count: 2,
      subject_boxes: [
        box(0.18, 0.22, 0.22, 0.55, true, "man left"),
        box(0.58, 0.22, 0.22, 0.55, false, "woman right"),
      ],
      motion: "low",
      emotion: ["conflict", "worry"],
      intensity: 7,
      has_dialogue: true,
      dialogue_native: "जमीन म्हारी सै",
      dialogue_translit: "jamin mhare sai",
      is_spoiler: false,
      usable: true,
      unusable_reason: null,
      croppable_11: false,
      croppable_916: false,
      crop_note: "two-shot never cropped",
    },
    {
      id: "ev_ttl_hry_01_003",
      title_id: "ttl_hry_01",
      start_ms: 10000,
      end_ms: 15000,
      description: "Close-up of the woman as she pushes the papers back.",
      shot_type: "CU",
      subject_count: 1,
      subject_boxes: [box(0.4, 0.18, 0.2, 0.55, true, "woman")],
      motion: "low",
      emotion: ["defiance"],
      intensity: 8,
      has_dialogue: true,
      dialogue_native: "ना, इब ना",
      dialogue_translit: "na, ib na",
      is_spoiler: false,
      usable: true,
      unusable_reason: null,
      croppable_11: true,
      croppable_916: true,
      crop_note: null,
    },
    {
      id: "ev_ttl_hry_01_004",
      title_id: "ttl_hry_01",
      start_ms: 15000,
      end_ms: 20000,
      description: "Medium close-up of the man standing, fists on the table.",
      shot_type: "MCU",
      subject_count: 1,
      subject_boxes: [box(0.36, 0.2, 0.22, 0.6, true, "man standing")],
      motion: "medium",
      emotion: ["anger"],
      intensity: 8,
      has_dialogue: false,
      dialogue_native: null,
      dialogue_translit: null,
      is_spoiler: false,
      usable: true,
      unusable_reason: null,
      croppable_11: true,
      croppable_916: true,
      crop_note: null,
    },
    {
      id: "ev_ttl_hry_01_005",
      title_id: "ttl_hry_01",
      start_ms: 20000,
      end_ms: 25000,
      description: "He slams the door and walks into the courtyard. Camera follows.",
      shot_type: "ACTION",
      subject_count: 1,
      subject_boxes: [box(0.3, 0.15, 0.28, 0.7, false, "man walking")],
      motion: "high",
      emotion: ["urgency"],
      intensity: 9,
      has_dialogue: true,
      dialogue_native: "देख ल्यो",
      dialogue_translit: "dekh lyo",
      is_spoiler: false,
      usable: true,
      unusable_reason: null,
      croppable_11: false,
      croppable_916: false,
      crop_note: "high motion",
    },
    {
      id: "ev_ttl_hry_01_006",
      title_id: "ttl_hry_01",
      start_ms: 25000,
      end_ms: 32000,
      description: "Wide of the farm at dusk, two small figures on the bund.",
      shot_type: "WIDE",
      subject_count: 2,
      subject_boxes: [
        box(0.3, 0.55, 0.06, 0.12, false, "figure a"),
        box(0.62, 0.52, 0.05, 0.12, false, "figure b"),
      ],
      motion: "static",
      emotion: ["unease"],
      intensity: 4,
      has_dialogue: false,
      dialogue_native: null,
      dialogue_translit: null,
      is_spoiler: false,
      usable: true,
      unusable_reason: null,
      croppable_11: false,
      croppable_916: false,
      crop_note: null,
    },
    {
      id: "ev_ttl_hry_01_007",
      title_id: "ttl_hry_01",
      start_ms: 32000,
      end_ms: 40000,
      description: "Insert of a land deed stamped in red ink.",
      shot_type: "INSERT",
      subject_count: 0,
      subject_boxes: [],
      motion: "static",
      emotion: ["dread"],
      intensity: 5,
      has_dialogue: false,
      dialogue_native: null,
      dialogue_translit: null,
      is_spoiler: false,
      usable: true,
      unusable_reason: null,
      croppable_11: true,
      croppable_916: true,
      crop_note: null,
    },
  ];
  const angles = [
    {
      id: "ang_hry_01_conflict",
      title_id: "ttl_hry_01",
      kind: "conflict",
      claim: "The land deal splits a household in one afternoon.",
      evidence_ids: ["ev_ttl_hry_01_002", "ev_ttl_hry_01_003", "ev_ttl_hry_01_005"],
      hook_candidate_ids: ["ev_ttl_hry_01_005"],
      audience_note: "Haryanvi viewers who know family-land fights.",
      spoiler_safe: true,
      vertical_feasible: false,
    },
    {
      id: "ang_hry_01_character",
      title_id: "ttl_hry_01",
      kind: "character",
      claim: "A man who will not sign.",
      evidence_ids: ["ev_ttl_hry_01_001", "ev_ttl_hry_01_004"],
      hook_candidate_ids: ["ev_ttl_hry_01_001"],
      audience_note: "Pride and stubbornness as the hook.",
      spoiler_safe: true,
      vertical_feasible: true,
    },
    {
      id: "ang_hry_01_relationship",
      title_id: "ttl_hry_01",
      kind: "relationship",
      claim: "Husband and wife on opposite sides of the same table.",
      evidence_ids: ["ev_ttl_hry_01_002", "ev_ttl_hry_01_003"],
      hook_candidate_ids: ["ev_ttl_hry_01_002"],
      audience_note: "Two-shot will not crop; compose vertical.",
      spoiler_safe: true,
      vertical_feasible: false,
    },
    {
      id: "ang_hry_01_world",
      title_id: "ttl_hry_01",
      kind: "world",
      claim: "The farm at dusk holds the argument.",
      evidence_ids: ["ev_ttl_hry_01_006", "ev_ttl_hry_01_007"],
      hook_candidate_ids: ["ev_ttl_hry_01_007"],
      audience_note: "Place as character.",
      spoiler_safe: true,
      vertical_feasible: false,
    },
    {
      id: "ang_hry_01_dialogue",
      title_id: "ttl_hry_01",
      kind: "dialogue",
      claim: "जमीन म्हारी सै — the line that starts the fight.",
      evidence_ids: ["ev_ttl_hry_01_002", "ev_ttl_hry_01_003"],
      hook_candidate_ids: ["ev_ttl_hry_01_002"],
      audience_note: "Burn the native line as a card.",
      spoiler_safe: true,
      vertical_feasible: false,
    },
    {
      id: "ang_hry_01_mystery",
      title_id: "ttl_hry_01",
      kind: "mystery",
      claim: "A red stamp on a deed nobody wanted to see.",
      evidence_ids: ["ev_ttl_hry_01_007", "ev_ttl_hry_01_004"],
      hook_candidate_ids: ["ev_ttl_hry_01_007"],
      audience_note: "Object as hook.",
      spoiler_safe: true,
      vertical_feasible: true,
    },
  ];
  const dir = path.resolve(process.cwd(), "data/snapshots/intelligence");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ttl_hry_01.json"),
    JSON.stringify({ title_id: "ttl_hry_01", evidence, angles, built_at: "2026-09-14T00:00:00.000Z" }, null, 2),
  );

  const rajEv = evidence.map((e) => ({
    ...e,
    id: e.id.replace("hry", "raj"),
    title_id: "ttl_raj_01",
  }));
  const rajAng = angles.map((a) => ({
    ...a,
    id: a.id.replace("hry", "raj"),
    title_id: "ttl_raj_01",
    evidence_ids: a.evidence_ids.map((x) => x.replace("hry", "raj")),
    hook_candidate_ids: a.hook_candidate_ids.map((x) => x.replace("hry", "raj")),
  }));
  fs.writeFileSync(
    path.join(dir, "ttl_raj_01.json"),
    JSON.stringify({ title_id: "ttl_raj_01", evidence: rajEv, angles: rajAng, built_at: "2026-09-14T00:00:00.000Z" }, null, 2),
  );
}

function writeClickhouse() {
  const dir = path.resolve(process.cwd(), "data/snapshots/clickhouse");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "scenes.json"),
    JSON.stringify(
      [
        { title_id: "ttl_hry_01", scene_id: "sc_hry_01", start_ms: 0, end_ms: 5000, frame_url: null, has_dialogue: false },
        { title_id: "ttl_hry_01", scene_id: "sc_hry_02", start_ms: 5000, end_ms: 10000, frame_url: null, has_dialogue: true },
        { title_id: "ttl_hry_01", scene_id: "sc_hry_03", start_ms: 10000, end_ms: 15000, frame_url: null, has_dialogue: true },
        { title_id: "ttl_hry_01", scene_id: "sc_hry_04", start_ms: 15000, end_ms: 20000, frame_url: null, has_dialogue: false },
        { title_id: "ttl_hry_01", scene_id: "sc_hry_05", start_ms: 20000, end_ms: 25000, frame_url: null, has_dialogue: true },
        { title_id: "ttl_hry_01", scene_id: "sc_hry_06", start_ms: 25000, end_ms: 32000, frame_url: null, has_dialogue: false },
        { title_id: "ttl_hry_01", scene_id: "sc_hry_07", start_ms: 32000, end_ms: 40000, frame_url: null, has_dialogue: false },
      ],
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, "performance.json"), JSON.stringify([], null, 2));
}

function writeMaster(titleId: string) {
  const out = path.resolve(process.cwd(), "data/media", `${titleId}.mp4`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const filter = [
    "color=c=0x2A241C:s=1920x1080:r=30:d=40[bg]",
    "[bg]drawbox=x=400:y=240:w=360:h=520:color=0xC45C3E@1:t=fill:enable='lt(t,5)'[s1]",
    "[s1]drawbox=x=280:y=240:w=340:h=500:color=0xC45C3E@1:t=fill:enable='between(t,5,10)'[s2a]",
    "[s2a]drawbox=x=1180:y=240:w=340:h=500:color=0xD4A574@1:t=fill:enable='between(t,5,10)'[s2]",
    "[s2]drawbox=x=780:y=180:w=380:h=560:color=0xD4A574@1:t=fill:enable='between(t,10,15)'[s3]",
    "[s3]drawbox=x=700:y=200:w=420:h=620:color=0xC45C3E@1:t=fill:enable='between(t,15,20)'[s4]",
    "[s4]drawbox=x=600:y=160:w=500:h=700:color=0x8B3A2A@1:t=fill:enable='between(t,20,25)'[s5]",
    "[s5]drawbox=x=200:y=700:w=80:h=140:color=0x889988@1:t=fill:enable='between(t,25,32)'[s6a]",
    "[s6a]drawbox=x=1200:y=680:w=70:h=130:color=0x889988@1:t=fill:enable='between(t,25,32)'[s6]",
    "[s6]drawbox=x=760:y=360:w=400:h=280:color=0xAA2222@1:t=fill:enable='gte(t,32)'[v]",
  ].join(";");
  sh("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=sin(2*PI*220*t):s=48000:d=40`,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "0:a",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-r",
    "30",
    out,
  ]);
}

async function main() {
  writeAntryami();
  writeIntelligence();
  writeClickhouse();
  await ctaPlates();
  writeMaster("ttl_hry_01");
  writeMaster("ttl_raj_01");
  console.log("assets ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
