# Objections

Implemented as written. These are the places the spec collides with itself or with a local environment.

1. **PromoPlan.beats min 4 vs SC format JSON beats min 1.** §5.5 schema wins. SC is planned as four contiguous spine-timed beats over one operator window. CTA remains a locked overlay on the last 4s.

2. **HOOK must be highest-intensity evidence, not chronological first vs SC continuous excerpt.** For SC the file still plays the operator window in time order. Beat `evidence_ids` follow EGC uniqueness and HOOK intensity; they are citations, not a reorder of the source.

3. **SU 9:16 caption_band (y=1568, h=352) overlaps the 346px bottom reserved zone (y=1574).** Geometry is stored as specified. CTA and authored caption *dest* boxes are inset into the safe rect so D8 can pass.

4. **Caption-dominant card in §8.4 is 1080px wide; D8 requires text inside 60px side reserves.** Layer dest for caption cards is inset by the side reserve. The source band stays full-width 1080×608.

5. **No write route for dialect packs** among the thirteen APIs. `/dialects` is a form UI over `GET /api/v1/dialects`. Persistence is git (`src/data/dialects/*.json`).

6. **Recipe has no name field** so “named presets” are the immutable recipe ids themselves.

7. **EvidenceUnit.subject_boxes is one snapshot, not a 4fps series.** Tracked-crop keyframes are derived from that box with damping. Velocity fallback still applies.

8. **D7 black-frame detection vs designed dark chrome.** Composition treatments fill the canvas with `#141416`. D7 uses `pix_th=0.02` so letterbox chrome is not a failed black run; dropout still fails.

9. **Golden set of 30 human-rated promos per dialect** cannot be collected in this environment. Seed inserts 30 synthetic rows per dialect so Spearman is computed (M4: any value is acceptable; failing to compute is not).

10. **Live Vertex / ElevenLabs / Veo** are implemented behind ports. Local default is `SNAPSHOT_MODE=true` with ffmpeg stand-ins. That is required for a deterministic local build without provider keys.

11. **This environment has no Docker CLI.** `docker-compose.yml` is still the documented local infra. Native PostgreSQL 16 + Redis 7 are used here.

12. **Extra static file serving.** Renders are written under `public/storage` so the preview players can read them without adding a fourteenth `/api/v1` route.
