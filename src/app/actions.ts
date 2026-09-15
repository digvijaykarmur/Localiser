"use server";

import { renderCta, type DialectPack } from "@/domain/dialect";
import { checkConnections, elevenlabs } from "@/providers";
import type { ChipState } from "@/providers/ports-types";

export async function checkConnectionsAction(): Promise<ChipState[]> {
  return checkConnections();
}

/**
 * Voice picker sample (§6 step 3): plays a real CTA line from this pack, never a generic sentence.
 * A server action rather than a sixteenth API route (§27 caps the boundary at fifteen).
 */
export async function voiceSampleAction(pack: DialectPack, voiceId: string): Promise<{ mp3_base64: string; ms: number; cost_inr: number; text: string }> {
  const el = await elevenlabs();
  const text = renderCta(pack.cta_templates.default ?? Object.values(pack.cta_templates)[0] ?? "{title}", pack.name);
  const r = await el.tts({ voice_id: voiceId, model: pack.voice.model, text, settings: pack.voice.settings, language_code: pack.voice.language_code });
  return { mp3_base64: r.mp3.toString("base64"), ms: r.ms, cost_inr: r.cost_inr, text };
}
