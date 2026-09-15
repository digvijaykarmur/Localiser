import fs from "node:fs";
import path from "node:path";
import { models } from "@/config/models";
import { AiReport, JudgeVerdict, textSimilarity, type EvidenceUnit, type PromoPlan, type Ratio, type Recipe, type Script, type Title } from "@/domain";
import { ffmpeg } from "@/lib/ffmpeg";
import { keys, storage, vertex } from "@/providers";
import { JUDGE_V2, withInput } from "@/prompts";
import { callModel } from "../cost/modelClient";
import type { CostMeter } from "../cost/meter";

/**
 * TBR (§3.5, §31.2): judges rendered pixels and audio, never the plan. Input: 1 fps frames from
 * the finished file, ASR of the finished audio, cited evidence descriptions, synopsis.
 */
export async function runJudge(i: {
  jobId: string;
  ratio: Ratio;
  renderPath: string;
  recipe: Recipe;
  title: Title;
  plan: PromoPlan;
  script: Script;
  evidence: Map<string, EvidenceUnit>;
  meter: CostMeter;
  hasVo: boolean;
  dialectName: string;
}): Promise<AiReport> {
  const v = await vertex();
  const st = storage();
  const framesDir = await st.localPath(keys.qcFrames(i.jobId, i.ratio));
  fs.mkdirSync(framesDir, { recursive: true });
  await ffmpeg(["-i", i.renderPath, "-vf", "fps=1,scale=540:-2", "-q:v", "4", path.join(framesDir, "f_%03d.jpg")]);
  const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).sort().slice(0, 60).map((f) => fs.readFileSync(path.join(framesDir, f)));

  let transcript = "";
  let cost = 0;
  if (v.mode === "real") {
    await i.meter.reserve("vertex.asr", 1);
    const audioPath = path.join(framesDir, "audio.m4a");
    await ffmpeg(["-i", i.renderPath, "-vn", "-c:a", "aac", "-b:a", "96k", audioPath]);
    const t = await v.transcribe({ model: models.asr.model, audio: fs.readFileSync(audioPath), mimeType: "audio/mp4", languageHint: i.dialectName, meta: { stage: "asr", prompt_version: "asr.v1", recipe_id: i.recipe.id } });
    transcript = t.text;
    cost += t.cost_inr;
    if (t.cost_inr > 0) await i.meter.charge("vertex.asr", t.cost_inr);
  }

  const cited = [...new Set(i.plan.beats.flatMap((b) => b.evidence_ids))].map((id) => i.evidence.get(id)).filter((e): e is EvidenceUnit => !!e);
  const input = {
    ratio: i.ratio,
    frame_count: frames.length,
    transcript,
    on_screen_text: i.script.lines.filter((l) => l.role === "caption").map((l) => l.text_native),
    evidence: cited.map((e) => ({ id: e.id, description: e.description, is_spoiler: e.is_spoiler })),
    synopsis: i.title.synopsis,
  };
  const r = await callModel({
    schema: JudgeVerdict,
    model: models.judge.model,
    temperature: models.judge.temperature ?? 0,
    system: JUDGE_V2.system,
    user: [...frames.map((image) => ({ image, mimeType: "image/jpeg" })), { text: withInput("Frames are in order at 1 per second. Judge the artefact.", input) }],
    meta: { stage: "judge", prompt_version: JUDGE_V2.version, recipe_id: i.recipe.id, title_id: i.recipe.title_id, job_id: i.jobId },
    meter: i.meter,
    costItem: "vertex.judge",
  });
  cost += r.cost_inr;

  const warnings: string[] = [];
  let a5: number | null = null;
  if (i.hasVo && transcript.trim().length > 0) {
    const intended = i.script.lines.filter((l) => l.role === "vo" || l.role === "presenter").map((l) => l.text_native).join(" ");
    a5 = textSimilarity(transcript, intended);
    if (a5 < 0.85) warnings.push(`R05_DIALECT_OFF: ASR similarity ${a5.toFixed(2)} < 0.85 — auto-release blocked`);
  } else if (i.hasVo && v.mode === "snapshot") warnings.push("A5 not computed: snapshot mode has no ASR");

  const j = r.value;
  const gates = j.A1_subject_integrity.pass && j.A2_claim_truth.pass && j.A3_spoiler.pass && j.A4_text_legibility.pass;
  return AiReport.parse({ ratio: i.ratio, judge: j, A5_dialect_similarity: a5, transcript, gates_pass: gates, warnings, model: r.model, prompt_version: JUDGE_V2.version, cost_inr: cost });
}
