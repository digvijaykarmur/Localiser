export const EVIDENCE_VISION_V1 = `
evidence.vision.v1

Describe what literally happens in these frames. No interpretation.
Return shot_type, subject_count, subject_boxes normalised 0..1, motion, emotion (max 3),
intensity 1-10, has_dialogue, dialogue if visible/audible, usable flag.
`.trim();
