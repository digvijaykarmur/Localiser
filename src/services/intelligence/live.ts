import {
  Angle,
  EvidenceUnit,
  ShotType,
  TitleIntelligence,
  applyCroppable,
  type Title,
} from "@/domain";
import type { AntryamiScene, AntryamiShot } from "@/providers/antryami";
import { nowIso } from "@/lib/hash";

function shotType(raw: string, characters: number): ShotType {
  const u = raw.toUpperCase().replace(/[\s-]+/g, "_");
  const parsed = ShotType.safeParse(u);
  if (parsed.success) return parsed.data;
  if (characters >= 3) return "GROUP";
  if (characters === 2) return "TWO_SHOT";
  if (/WIDE|ESTABLISH/.test(u)) return "WIDE";
  if (/INSERT|CUTAWAY/.test(u)) return "INSERT";
  if (/ACTION/.test(u)) return "ACTION";
  if (/ECU|EXTREME/.test(u)) return "ECU";
  if (/MCU|MEDIUM_CLOSE/.test(u)) return "MCU";
  if (/CU|CLOSE/.test(u)) return "CU";
  return "MS";
}

function motion(camera: string): "static" | "low" | "medium" | "high" {
  const c = camera.toLowerCase();
  if (c.includes("static")) return "static";
  if (c.includes("hand")) return "high";
  if (c.includes("pan") || c.includes("tilt")) return "medium";
  return "low";
}

export function intelligenceFromLive(args: {
  title: Title;
  scenes: AntryamiScene[];
  shots: AntryamiShot[];
}): TitleIntelligence {
  const { title, scenes, shots } = args;
  const sceneById = new Map(scenes.map((s) => [s.scene_id, s]));
  const units: EvidenceUnit[] = [];
  const source = shots.length
    ? shots
    : scenes.map((s) => ({
        shot_id: s.scene_id,
        scene_id: s.scene_id,
        start_ms: s.start_ms,
        end_ms: s.end_ms,
        shot_scale: "MS",
        action: s.summary || s.label || "",
        camera: "static",
        characters: s.characters ?? [],
      }));

  const ranked = [...source].sort((a, b) => {
    const score = (sh: (typeof source)[number]) => {
      const scene = sceneById.get(sh.scene_id);
      const blob = `${scene?.label ?? ""} ${sh.action ?? ""}`;
      let n = scene?.intensity || 4;
      if (scene?.spoiler) n -= 40;
      if (/credit|logo|interstitial/i.test(blob)) n -= 20;
      if (scene?.quotable) n += 3;
      return n;
    };
    return score(b) - score(a);
  });

  for (const sh of ranked.slice(0, 48)) {
    const scene = sceneById.get(sh.scene_id);
    const chars = sh.characters.length || scene?.characters?.length || 0;
    const desc = (sh.action || scene?.summary || scene?.label || "scene").slice(0, 400);
    const intensity = Math.min(10, Math.max(1, Math.round(scene?.intensity || 4)));
    const spoiler = Boolean(scene?.spoiler);
    const interstitial = /credit|logo|interstitial/i.test(`${scene?.label ?? ""} ${desc}`);
    const unit = applyCroppable({
      id: `ev_${title.id}_${sh.shot_id}`.replace(/[^a-zA-Z0-9_:-]+/g, "_"),
      title_id: title.id,
      start_ms: sh.start_ms,
      end_ms: Math.max(sh.end_ms, sh.start_ms + 400),
      description: desc,
      shot_type: shotType(sh.shot_scale, chars),
      subject_count: chars,
      subject_boxes: chars
        ? Array.from({ length: Math.min(chars, 3) }, (_, i) => ({
            x: 0.2 + i * 0.2,
            y: 0.2,
            w: 0.2,
            h: 0.5,
            is_speaking: i === 0,
            label: sh.characters[i] || `subject_${i}`,
          }))
        : [],
      motion: motion(sh.camera),
      emotion: scene?.conflict && scene.conflict !== "none" ? ["tension"] : ["neutral"],
      intensity,
      has_dialogue: Boolean(scene?.quotable || scene?.has_dialogue),
      dialogue_native: scene?.quotable ?? null,
      dialogue_translit: null,
      is_spoiler: spoiler,
      usable: !spoiler && !interstitial && sh.end_ms - sh.start_ms >= 700,
      unusable_reason: spoiler ? "spoiler" : interstitial ? "interstitial" : null,
      crop_note: null,
    });
    units.push(unit);
  }

  const usable = units.filter((u) => u.usable);
  const pool = usable.length >= 2 ? usable : units;
  const pick = (n: number, start: number) => {
    const ids = pool.slice(start, start + Math.max(2, n)).map((u) => u.id);
    if (ids.length >= 2) return ids;
    return pool.slice(0, 2).map((u) => u.id);
  };
  const angles: Angle[] = [];
  const kinds = [
    { kind: "conflict" as const, claim: `${title.name}: the fight that splits the house.` },
    { kind: "character" as const, claim: `${title.name}: a face you cannot look away from.` },
    { kind: "world" as const, claim: `${title.name}: the place this story lives.` },
    { kind: "relationship" as const, claim: `${title.name}: two people, one breaking point.` },
    { kind: "mystery" as const, claim: `${title.name}: something is being kept from you.` },
    { kind: "dialogue" as const, claim: `${title.name}: the line that lands.` },
  ];
  kinds.forEach((k, i) => {
    const evidence_ids = pick(3, i * 2);
    if (evidence_ids.length < 2) return;
    angles.push(
      Angle.parse({
        id: `ang_${title.id}_${k.kind}`,
        title_id: title.id,
        kind: k.kind,
        claim: k.claim.slice(0, 180),
        evidence_ids,
        hook_candidate_ids: [evidence_ids[0]!],
        audience_note: "Built from Antaryami scene/shot layer.",
        spoiler_safe: pool.every((u) => !u.is_spoiler || !evidence_ids.includes(u.id)),
        vertical_feasible: true,
      }),
    );
  });

  return TitleIntelligence.parse({
    title_id: title.id,
    evidence: units,
    angles: angles.slice(0, 6),
    built_at: nowIso(),
  });
}

/** When CMS video is 403 we only have a ~90s local stand-in. Planner SC window is 5–25s. */
export function fitEvidenceToMedia(evidence: EvidenceUnit[], mediaMs: number): EvidenceUnit[] {
  if (!evidence.length || mediaMs < 2000) return evidence;
  const maxEnd = Math.max(...evidence.map((e) => e.end_ms));
  if (maxEnd <= mediaMs) return evidence;
  const lo = Math.min(5000, Math.max(0, Math.floor(mediaMs * 0.08)));
  const hi = Math.max(lo + 4000, Math.min(25000, mediaMs - 400));
  const span = Math.max(1000, hi - lo);
  const n = evidence.length;
  return evidence.map((e, i) => {
    const dur = Math.min(Math.max(e.end_ms - e.start_ms, 800), 2500, span);
    const start = n === 1 ? lo : lo + Math.floor((i * (span - dur)) / Math.max(1, n - 1));
    return applyCroppable({ ...e, start_ms: start, end_ms: start + dur });
  });
}
