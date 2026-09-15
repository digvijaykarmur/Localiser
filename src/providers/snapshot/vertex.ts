import { spawn } from "node:child_process";
import sharp from "sharp";
import { CANVAS, type AngleProposal, type EvidenceDescription, type Ratio } from "@/domain";
import type { Content, GenerateResult, ModelCallMeta, VertexPort } from "../ports";
import { extractInputJson, readJson } from "./fixtures";

/**
 * Offline stand-in for Gemini/Veo. Returns fixture data where it exists and otherwise a
 * deterministic, schema-valid synthesis so the whole pipeline runs with zero network and
 * zero cost. This is not intelligence; it is plumbing for tests and composition iteration.
 */
export class SnapshotVertex implements VertexPort {
  readonly mode = "snapshot" as const;

  private result<T>(value: T): GenerateResult<T> {
    return { value, raw_text: JSON.stringify(value), cost_inr: 0, tokens: { in: 0, out: 0 }, latency_ms: 1 };
  }

  private textOf(user: Content[]): string {
    return user
      .map((c) => ("text" in c ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }

  async generate<T>(args: { model: string; system: string; user: Content[]; temperature: number; meta: ModelCallMeta }): Promise<GenerateResult<T>> {
    const input = extractInputJson<Record<string, unknown>>(this.textOf(args.user)) ?? {};
    switch (args.meta.stage) {
      case "evidence_vision":
        return this.result(this.evidence(input) as T);
      case "angles":
        return this.result(this.angles(input) as T);
      case "plan":
        return this.result(this.plan(input) as T);
      case "script":
        return this.result(this.script(input) as T);
      case "judge":
        return this.result(this.judge() as T);
      default:
        throw new Error(`SnapshotVertex: no stub for stage ${args.meta.stage}`);
    }
  }

  async vision<T>(args: { text: string; meta: ModelCallMeta }): Promise<GenerateResult<T>> {
    return this.generate<T>({ model: "snapshot", system: "", user: [{ text: args.text }], temperature: 0, meta: args.meta });
  }

  // --- evidence -------------------------------------------------------------------------
  private evidence(input: Record<string, unknown>): EvidenceDescription {
    const titleId = String(input.title_id ?? "");
    const seq = Number(input.seq ?? 0);
    const fixture = readJson<EvidenceDescription[]>(`titles/${titleId}/evidence.json`, []);
    const found = fixture[seq];
    if (found) return found;
    const shots: EvidenceDescription["shot_type"][] = ["CU", "MS", "TWO_SHOT", "WIDE", "MCU", "GROUP", "INSERT", "ACTION", "ECU"];
    const shot = shots[seq % shots.length]!;
    const count = shot === "TWO_SHOT" ? 2 : shot === "GROUP" ? 3 : shot === "WIDE" || shot === "INSERT" ? 0 : 1;
    return {
      description: `Scene ${seq}: a ${shot} shot in a village courtyard.`,
      shot_type: shot,
      subject_count: count,
      subject_boxes: Array.from({ length: Math.min(count, 6) }, (_, i) => ({ x: 0.2 + i * 0.3, y: 0.2, w: 0.2, h: 0.5, is_speaking: i === 0, label: `person ${i + 1}` })),
      motion: shot === "ACTION" ? "high" : "low",
      emotion: ["tense"],
      intensity: 3 + (seq % 6),
      has_dialogue: count > 0,
      dialogue_native: count > 0 ? "थम के बोल रहे सो?" : null,
      is_spoiler: false,
      usable: true,
      unusable_reason: null,
    };
  }

  // --- angles ---------------------------------------------------------------------------
  private angles(input: Record<string, unknown>): { angles: AngleProposal[] } {
    const titleId = String(input.title_id ?? "");
    const fixture = readJson<AngleProposal[] | null>(`titles/${titleId}/angles.json`, null);
    if (fixture && fixture.length === 6) return { angles: fixture };
    const ev = (input.evidence as { id: string; intensity: number; is_spoiler: boolean }[]) ?? [];
    const ids = ev.filter((e) => !e.is_spoiler).sort((a, b) => b.intensity - a.intensity).map((e) => e.id);
    const kinds: AngleProposal["kind"][] = ["conflict", "character", "relationship", "mystery", "dialogue", "world"];
    return {
      angles: kinds.map((kind, i) => ({
        kind,
        claim: `Snapshot angle ${i + 1} (${kind}) grounded in ${Math.min(4, ids.length)} scenes`,
        evidence_ids: ids.slice(i % 2, (i % 2) + 4).length >= 2 ? ids.slice(i % 2, (i % 2) + 4) : ids.slice(0, 2),
        hook_candidate_ids: ids.slice(0, 1),
        audience_note: "snapshot",
        spoiler_safe: true,
      })),
    };
  }

  // --- plan -----------------------------------------------------------------------------
  private plan(input: Record<string, unknown>) {
    const ev = (input.evidence as { id: string; intensity: number; has_dialogue: boolean; start_ms: number; end_ms: number }[]) ?? [];
    const target = Number(input.target_body_ms ?? 25_000);
    const beatMin = Number(input.beat_min_ms ?? 1600);
    const beatMax = Number(input.beat_max_ms ?? 4200);
    const hookMax = Number(input.hook_max_ms ?? 3000);
    const spine = String(input.spine ?? "full");
    const ctaMs = Number(input.cta_ms ?? 5000);
    const hookIds = (input.hook_candidate_ids as string[]) ?? [];
    const len = (e: { start_ms: number; end_ms: number }) => e.end_ms - e.start_ms;

    const sorted = [...ev].sort((a, b) => b.intensity - a.intensity);
    const hook = sorted.find((e) => hookIds.includes(e.id)) ?? sorted[0];
    if (!hook) return { beats: [] };
    const used = new Set<string>([hook.id]);

    const beats: Record<string, unknown>[] = [];
    const hookMs = Math.min(hookMax, len(hook), Math.max(beatMin, 3000));
    beats.push({ role: "HOOK", duration_ms: hookMs, evidence_ids: [hook.id], intensity: hook.intensity, treatment: "NATIVE", treatment_reason: "highest intensity moment", caption_text: null });

    if (spine === "light") {
      // Adjacent moments, longest first, at most two ESCALATE beats, each capped by its unit length.
      const adjacent = ev.filter((e) => e.id !== hook.id).sort((a, b) => Math.abs(a.start_ms - hook.start_ms) - Math.abs(b.start_ms - hook.start_ms)).slice(0, 2).sort((a, b) => len(b) - len(a));
      let remaining = target - hookMs;
      let intensity = 1;
      adjacent.forEach((e, i) => {
        if (remaining < beatMin) return;
        const isLast = i === adjacent.length - 1;
        let d = Math.min(len(e), remaining);
        // leave the next beat at least beatMin unless this is the last one
        if (!isLast && remaining - d > 0 && remaining - d < beatMin) d = Math.max(beatMin, remaining - beatMin);
        intensity = Math.max(intensity, e.intensity);
        beats.push({ role: "ESCALATE", duration_ms: d, evidence_ids: [e.id], intensity, treatment: "NATIVE", treatment_reason: "continuation of the moment", caption_text: null });
        used.add(e.id);
        remaining -= d;
      });
    } else {
      const rest = ev.filter((e) => e.id !== hook.id).sort((a, b) => a.start_ms - b.start_ms);
      const bodyMs = target - hookMs;
      // reserve one distinct unit for the CTA citation
      const maxBeats = Math.max(0, rest.length - 1);
      const n = Math.min(maxBeats, Math.max(3, Math.min(6, Math.ceil(bodyMs / 3800))));
      const per = Math.max(beatMin, Math.min(beatMax, Math.floor(bodyMs / Math.max(1, n))));
      const roles = ["STAKE", "TURN", ...Array.from({ length: Math.max(0, n - 2) }, () => "ESCALATE")];
      let intensity = Math.max(1, Math.min(hook.intensity - 3, 4));
      roles.forEach((role, i) => {
        const e = rest[i];
        if (!e) return;
        if (role === "TURN") intensity = Math.min(10, intensity + 2);
        else if (role === "ESCALATE") intensity = Math.min(10, intensity + 1);
        beats.push({ role, duration_ms: Math.min(per, len(e)), evidence_ids: [e.id], intensity, treatment: "NATIVE", treatment_reason: `${role.toLowerCase()} beat`, caption_text: null });
        used.add(e.id);
      });
      // fix rounding so body sums to target, spreading the remainder over beats with headroom
      let diff = target - beats.reduce((s, b) => s + Number(b.duration_ms), 0);
      for (let i = beats.length - 1; i >= 1 && diff !== 0; i--) {
        const b = beats[i]!;
        const e = ev.find((x) => x.id === (b.evidence_ids as string[])[0])!;
        const cap = Math.min(beatMax, len(e));
        const next = Math.max(beatMin, Math.min(cap, Number(b.duration_ms) + diff));
        diff -= next - Number(b.duration_ms);
        b.duration_ms = next;
      }
    }
    const ctaEvidence = sorted.find((e) => !used.has(e.id)) ?? hook;
    beats.push({ role: "CTA", duration_ms: ctaMs, evidence_ids: [ctaEvidence.id], intensity: 10, treatment: "NATIVE", treatment_reason: "cta card", caption_text: null });
    return { beats };
  }

  // --- script ---------------------------------------------------------------------------
  private script(input: Record<string, unknown>) {
    const beats = (input.beats as { index: number; role: string; evidence_ids: string[]; dialogue: string[] }[]) ?? [];
    const budget = Number(input.budget_words ?? 60);
    const dialect = String(input.dialect ?? "hry");
    const lines: Record<string, unknown>[] = [];
    const bank = SNAPSHOT_LINES[dialect] ?? SNAPSHOT_LINES.hry!;
    let used = 0;
    const body = beats.filter((b) => b.role !== "CTA");
    const perBeat = Math.max(3, Math.floor(budget / Math.max(1, body.length)) - 1);
    body.forEach((b, i) => {
      const src = bank[i % bank.length]!;
      const words = src.split(" ").slice(0, perBeat);
      if (used + words.length > budget) return;
      used += words.length;
      lines.push({ beat_index: b.index, role: "vo", text_native: words.join(" "), evidence_ids: b.evidence_ids.slice(0, 1) });
      const cap = words.slice(0, 4).join(" ");
      lines.push({ beat_index: b.index, role: "caption", text_native: cap, evidence_ids: b.evidence_ids.slice(0, 1) });
    });
    return { lines };
  }

  // --- judge ----------------------------------------------------------------------------
  private judge() {
    return {
      A1_subject_integrity: { pass: true, evidence: "snapshot judge: no frames inspected", offending_frames: [] },
      A2_claim_truth: { pass: true, evidence: "snapshot judge", unsupported_lines: [] },
      A3_spoiler: { pass: true, evidence: "snapshot judge" },
      A4_text_legibility: { pass: true, evidence: "snapshot judge" },
      A6_hook_strength: { score: 6, reasoning: "snapshot judge: uncalibrated placeholder" },
      A7_pacing: { score: 6, reasoning: "snapshot judge: uncalibrated placeholder" },
      A8_overall_craft: { score: 6, reasoning: "snapshot judge: uncalibrated placeholder" },
    };
  }

  // --- media ----------------------------------------------------------------------------
  async image(args: { prompt: string; ratio: Ratio }): Promise<{ png: Buffer; cost_inr: number }> {
    const c = CANVAS[args.ratio];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.w}" height="${c.h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a4a"/><stop offset="1" stop-color="#141416"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${c.w / 2}" cy="${c.h * 0.42}" r="${Math.min(c.w, c.h) * 0.16}" fill="#c9a27a"/></svg>`;
    return { png: await sharp(Buffer.from(svg)).png().toBuffer(), cost_inr: 0 };
  }

  async video(args: { ratio: Ratio; duration_ms: number }): Promise<{ mp4: Buffer; cost_inr: number }> {
    const c = CANVAS[args.ratio];
    const d = (args.duration_ms / 1000).toFixed(2);
    const mp4 = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn("ffmpeg", [
        "-hide_banner", "-nostdin", "-y",
        "-f", "lavfi", "-i", `color=c=0x2b3a55:s=${c.w}x${c.h}:r=30:d=${d}`,
        "-vf", `drawbox=x=(iw-iw*0.36)/2:y=ih*0.18:w=iw*0.36:h=ih*0.5:color=0xc9a27a@1:t=fill`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "23",
        "-movflags", "+frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
      ]);
      const chunks: Buffer[] = [];
      let err = "";
      child.stdout.on("data", (b: Buffer) => chunks.push(b));
      child.stderr.on("data", (b: Buffer) => (err += b.toString()));
      child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`snapshot presenter video: ffmpeg exited ${code}: ${err.slice(-300)}`))));
      child.on("error", reject);
    });
    return { mp4, cost_inr: 0 };
  }

  async transcribe(): Promise<{ text: string; cost_inr: number }> {
    return { text: "", cost_inr: 0 };
  }

  async canary(): Promise<{ ok: boolean; error?: string; latency_ms: number }> {
    return { ok: true, latency_ms: 0 };
  }
}

const SNAPSHOT_LINES: Record<string, string[]> = {
  hry: [
    "कल्याणी नै जिब वो चिट्ठी मिली, सारा गाम हिल गया",
    "एक ब्याह, दो घर, अर एक राज जो कोए कोन्या जाणता",
    "ताऊ बोल्या के सै, पर छोरी नै सुणी कोन्या",
    "इब फैसला उसका सै, अर वक्त घणा कम सै",
    "जो सच बाहर आया, वो किसे नै भी बेरा कोन्या था",
    "म्हारे गाम की कहाणी, म्हारी ही बोली में",
  ],
  raj: [
    "ढोला नै जद वो खबर मिली, सगळो गांव चुप हो गयो",
    "एक वादो, दो घर, अर एक राज जो कोई कोनी जाणै",
    "बाई बोली कांई, पर टाबर नै सुणी कोनी",
    "अब फैसलो उणरो है, अर बखत घणो कम है",
    "जो सच बारै आयो, वो किणी नै कोनी ठा थो",
    "म्हारै गांव री कहाणी, म्हारी ही बोली में",
  ],
};
