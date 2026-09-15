import {
  boxCentroid,
  CANVAS,
  CAPTION_DOMINANT,
  centredCrop,
  fullCanvas,
  kenBurnsSource,
  MASTER,
  nativeCaptionBox,
  planTrackedCrop,
  safeBox,
  samplesFromBoxes,
  STACKED,
  Timeline,
  type AudioTrack,
  type Beat,
  type EvidenceUnit,
  type FormatPolicy,
  type Layer,
  type PromoPlan,
  type Ratio,
  type Script,
} from "@/domain";

/** What the composer needs to know about an asset. Resolved to paths only at render time. */
export interface AssetRef {
  id: string;
  kind: "source_cut" | "vo" | "music" | "caption_card" | "cta_card" | "cta_bg" | "presenter" | "still";
  ratio: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  meta: { beat_index?: number; line_id?: string; evidence_id?: string; segment?: number };
}

export interface BuildTimelineInput {
  plan: PromoPlan;
  script: Script;
  assets: AssetRef[];
  evidence: Map<string, EvidenceUnit>;
  policy: FormatPolicy;
  ratio: Ratio;
}

const Z = { source: 10, presenter: 10, still: 10, caption: 20, cta_bg: 30, cta_card: 40 } as const;

/** S7a — plan + script + assets → Timeline for one ratio. Pure. Every element in output pixels. */
export function buildTimeline(i: BuildTimelineInput): Timeline {
  const { plan, script, assets, evidence, policy, ratio } = i;
  const canvas = CANVAS[ratio];
  const layers: Layer[] = [];
  const audio: AudioTrack[] = [];
  const find = (kind: AssetRef["kind"], pred: (a: AssetRef) => boolean = () => true) => assets.find((a) => a.kind === kind && (a.ratio === null || a.ratio === ratio) && pred(a));

  const hasVo = policy.has_vo && assets.some((a) => a.kind === "vo");
  const music = policy.has_music ? find("music") : undefined;
  const presenterSegs = policy.has_presenter ? assets.filter((a) => a.kind === "presenter" && (a.ratio === null || a.ratio === ratio || a.ratio === "9:16")).sort((a, b) => (a.meta.segment ?? 0) - (b.meta.segment ?? 0)) : [];

  for (const beat of plan.beats) {
    const start = beat.start_ms;
    const end = beat.start_ms + beat.duration_ms;
    const captionLine = script.lines.find((l) => l.beat_index === beat.index && l.role === "caption");
    const captionAsset = captionLine ? find("caption_card", (a) => a.meta.line_id === captionLine.id) : undefined;

    if (beat.role === "CTA") {
      const bg = find("cta_bg");
      if (bg) layers.push(imageLayer(`cta_bg_${beat.index}`, Z.cta_bg, "image", bg.id, start, end, fullCanvas(ratio)));
      const card = find("cta_card");
      if (card) layers.push(imageLayer(`cta_${beat.index}`, Z.cta_card, "cta_card", card.id, start, end, ctaTextBox(ratio, card)));
      continue;
    }

    const primary = evidence.get(beat.evidence_ids[0]!);
    const cut = find("source_cut", (a) => a.meta.evidence_id === beat.evidence_ids[0]) ?? find("source_cut", (a) => a.meta.beat_index === beat.index);
    const cutDur = cut?.duration_ms ?? beat.duration_ms;
    const sourceOut = Math.min(cutDur, beat.duration_ms);
    // No music bed: the last moment's own audio carries under the CTA card and fades, so the CTA is never silent (D6).
    const ctaBeat = plan.beats.find((b) => b.role === "CTA");
    const isLastBody = ctaBeat ? plan.beats.filter((b) => b.role !== "CTA").at(-1)?.index === beat.index : false;
    const audioTailMs = !music && isLastBody && ctaBeat ? Math.max(0, Math.min(cutDur, beat.duration_ms + ctaBeat.duration_ms) - beat.duration_ms) : 0;
    const audioOut = sourceOut + audioTailMs;
    const boxes = primary?.subject_boxes ?? [];
    const speaking = boxes.find((b) => b.is_speaking) ?? boxes[0];
    const centre = speaking ? boxCentroid(speaking) : { cx: 0.5, cy: 0.5 };

    const pushSource = (dest: Layer["dest"], crop: { src_crop: Layer["src_crop"]; crop_keyframes: Layer["crop_keyframes"] }) => {
      if (!cut) return;
      layers.push({
        id: `src_${beat.index}`,
        z: Z.source,
        type: "source_clip",
        start_ms: start,
        end_ms: end,
        dest,
        asset_id: cut.id,
        source_in_ms: 0,
        source_out_ms: sourceOut,
        src_crop: crop.src_crop,
        crop_keyframes: crop.crop_keyframes,
        fill_color: null,
        opacity: 1,
      });
      if (policy.keep_source_audio)
        audio.push({
          id: `a_src_${String(beat.index).padStart(2, "0")}`,
          role: "source",
          asset_id: cut.id,
          start_ms: start,
          source_in_ms: 0,
          source_out_ms: audioOut,
          gain_db: hasVo ? -9 : 0,
          duck_against: hasVo ? voTrackId(beat.index) : null,
          fade_in_ms: 40,
          fade_out_ms: audioTailMs ? Math.round(audioTailMs * 0.7) : 120,
        });
    };

    switch (beat.treatment) {
      case "NATIVE":
      case "GENERATED_NATIVE": {
        pushSource(fullCanvas(ratio), { src_crop: null, crop_keyframes: null });
        if (captionAsset) layers.push(imageLayer(`cap_${beat.index}`, Z.caption, "caption_card", captionAsset.id, start, end, nativeCaptionBox(ratio)));
        break;
      }
      case "TRACKED_CROP": {
        const tracked = planTrackedCrop(ratio, samplesFromBoxes(boxes, beat.duration_ms));
        if (tracked) pushSource(fullCanvas(ratio), { src_crop: null, crop_keyframes: tracked.keyframes });
        else pushSource(fullCanvas(ratio), { src_crop: centredCrop(ratio, centre.cx, centre.cy), crop_keyframes: null });
        if (captionAsset) layers.push(imageLayer(`cap_${beat.index}`, Z.caption, "caption_card", captionAsset.id, start, end, nativeCaptionBox(ratio)));
        break;
      }
      case "STATIC_CROP":
      case "SPEAKER_CUT": {
        pushSource(fullCanvas(ratio), { src_crop: centredCrop(ratio, centre.cx, centre.cy), crop_keyframes: null });
        if (captionAsset) layers.push(imageLayer(`cap_${beat.index}`, Z.caption, "caption_card", captionAsset.id, start, end, nativeCaptionBox(ratio)));
        break;
      }
      case "CAPTION_DOMINANT":
      case "INSET": {
        const g = CAPTION_DOMINANT[ratio];
        pushSource(g.source, { src_crop: null, crop_keyframes: null });
        if (captionAsset) layers.push(imageLayer(`cap_${beat.index}`, Z.caption, "caption_card", captionAsset.id, start, end, g.caption));
        break;
      }
      case "STACKED": {
        const g = STACKED[ratio];
        pushSource(g.source, { src_crop: null, crop_keyframes: null });
        placePresenter(layers, presenterSegs, ratio, start, end, beat.index);
        if (captionAsset) layers.push(imageLayer(`cap_${beat.index}`, Z.caption, "caption_card", captionAsset.id, start, end, g.caption));
        break;
      }
      case "KENBURNS_STILL": {
        const still = find("still", (a) => a.meta.beat_index === beat.index);
        if (still) {
          const k0 = kenBurnsSource(ratio, centre.cx, 1.0);
          const k1 = kenBurnsSource(ratio, centre.cx, 1.08);
          layers.push({
            id: `still_${beat.index}`,
            z: Z.still,
            type: "image",
            start_ms: start,
            end_ms: end,
            dest: fullCanvas(ratio),
            asset_id: still.id,
            source_in_ms: null,
            source_out_ms: null,
            src_crop: null,
            crop_keyframes: [
              { t_ms: 0, box: k0 },
              { t_ms: beat.duration_ms, box: k1 },
            ],
            fill_color: null,
            opacity: 1,
          });
          if (cut && policy.keep_source_audio)
            audio.push({ id: `a_src_${String(beat.index).padStart(2, "0")}`, role: "source", asset_id: cut.id, start_ms: start, source_in_ms: 0, source_out_ms: audioOut, gain_db: hasVo ? -9 : 0, duck_against: hasVo ? voTrackId(beat.index) : null, fade_in_ms: 40, fade_out_ms: audioTailMs ? Math.round(audioTailMs * 0.7) : 120 });
        } else {
          const g = CAPTION_DOMINANT[ratio];
          pushSource(g.source, { src_crop: null, crop_keyframes: null });
        }
        if (captionAsset) layers.push(imageLayer(`cap_${beat.index}`, Z.caption, "caption_card", captionAsset.id, start, end, CAPTION_DOMINANT[ratio].caption));
        break;
      }
    }

    // VO for this beat
    if (hasVo) {
      const voLine = script.lines.find((l) => l.beat_index === beat.index && (l.role === "vo" || l.role === "presenter"));
      const vo = voLine ? find("vo", (a) => a.meta.line_id === voLine.id) : undefined;
      if (vo) {
        const voDur = Math.min(vo.duration_ms ?? beat.duration_ms, beat.duration_ms + 400);
        audio.push({ id: voTrackId(beat.index), role: "vo", asset_id: vo.id, start_ms: start + 120, source_in_ms: 0, source_out_ms: voDur, gain_db: 0, duck_against: null, fade_in_ms: 0, fade_out_ms: 60 });
      }
    }
  }

  if (music) {
    const dur = Math.min(music.duration_ms ?? plan.total_duration_ms, plan.total_duration_ms);
    const firstVo = audio.find((a) => a.role === "vo");
    audio.push({ id: "a_music", role: "music", asset_id: music.id, start_ms: 0, source_in_ms: 0, source_out_ms: dur, gain_db: hasVo ? -16 : -10, duck_against: firstVo ? firstVo.id : null, fade_in_ms: 300, fade_out_ms: 900 });
  }
  // multiple VO tracks: music ducks against the first; every VO also ducks nothing. Sidechain against a
  // single mixed VO bus would be ideal; keep it simple and deterministic.

  return Timeline.parse({ recipe_id: plan.recipe_id, ratio, width: canvas.w, height: canvas.h, fps: 30, duration_ms: plan.total_duration_ms, layers, audio });
}

function voTrackId(beatIndex: number) {
  return `a_vo_${String(beatIndex).padStart(2, "0")}`;
}

function imageLayer(id: string, z: number, type: Layer["type"], assetId: string, start: number, end: number, dest: Layer["dest"]): Layer {
  return { id, z, type, start_ms: start, end_ms: end, dest, asset_id: assetId, source_in_ms: null, source_out_ms: null, src_crop: null, crop_keyframes: null, fill_color: null, opacity: 1 };
}

/** CTA text card is rendered at the safe-area size by the assembler; place it where it was rendered. */
/** The CTA card is authored at safe-area size; it sits inside the safe box, not centred on the canvas (D8). */
function ctaTextBox(ratio: Ratio, card: AssetRef): Layer["dest"] {
  const sb = safeBox(ratio);
  const w = Math.min(card.width ?? sb.w, sb.w);
  const h = Math.min(card.height ?? sb.h, sb.h);
  return { x: sb.x + Math.round((sb.w - w) / 2), y: sb.y + Math.round((sb.h - h) / 2), w, h };
}

/**
 * Presenter segments (≤8s each from Veo) placed back to back across the promo body. Generated
 * once at 9:16; 16:9 uses it as a native left column, 1:1 uses a face-centred static crop of
 * the upper third (see OBJECTIONS.md).
 */
function placePresenter(layers: Layer[], segs: AssetRef[], ratio: Ratio, start: number, end: number, beatIndex: number) {
  if (!segs.length) return;
  const g = STACKED[ratio];
  // walk segments to cover [start,end)
  let cursor = 0;
  let idx = 0;
  let t = start;
  while (t < end && idx < segs.length) {
    const seg = segs[idx]!;
    const segDur = seg.duration_ms ?? 8000;
    const segStart = cursor;
    const segEnd = cursor + segDur;
    if (segEnd <= t) {
      cursor = segEnd;
      idx++;
      continue;
    }
    const layerStart = Math.max(t, segStart);
    const layerEnd = Math.min(end, segEnd);
    const srcIn = layerStart - segStart;
    const srcOut = layerEnd - segStart;
    let dest = g.presenter;
    let srcCrop: Layer["src_crop"] = null;
    if (ratio === "16:9") dest = { x: 16, y: 0, w: 608, h: 1080 };
    if (ratio === "1:1") {
      // 9:16 generated at 1080×1920 → take a 1080×(1080*h/w) band around the face (upper third)
      const bandH = Math.round((1080 * g.presenter.h) / g.presenter.w);
      srcCrop = { x: 0, y: Math.max(0, Math.round(1920 * 0.3 - bandH / 2)), w: 1080, h: bandH };
    }
    layers.push({
      id: `pres_${beatIndex}_${idx}`,
      z: Z.presenter,
      type: "generated_video",
      start_ms: layerStart,
      end_ms: layerEnd,
      dest,
      asset_id: seg.id,
      source_in_ms: srcIn,
      source_out_ms: srcOut,
      src_crop: srcCrop,
      crop_keyframes: null,
      fill_color: null,
      opacity: 1,
    });
    t = layerEnd;
    if (layerEnd >= segEnd) {
      cursor = segEnd;
      idx++;
    }
  }
}

export { MASTER };
