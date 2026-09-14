# STAGE Promo Engine

Source-grounded promotional video production for a regional-language OTT catalogue. One editorial decision, three delivery ratios, measured output quality.

Authoritative spec: the build document in the originating issue. Where code and that document disagree, schemas in `src/domain` win.

## Make a promo (local production)

```bash
sudo service postgresql start
sudo service redis-server start   # or: redis-server --daemonize yes

pnpm install
pnpm ready          # ffmpeg, postgres, redis, media, seed, provider status
pnpm env:check      # live Vertex / ElevenLabs / ClickHouse pings
pnpm dev            # Next on :3000 + BullMQ worker
```

Open http://localhost:3000

1. Library → a **live Antaryami title** (Haryanvi catalogue uses `har`, shown as `hry`). Snapshot titles (`ttl_hry_01`) are fallback only.
2. **Build intelligence** — scenes, shots, and dialogue come from Antaryami; ClickHouse supplies episode scene timings when Antaryami scenes are empty.
3. **compose** tab → format:
   - **SC** (Single Clip) — fastest, source audio, first promo to run.
   - **CP** (Caption Promo) — dialect VO + music; uses live ElevenLabs when `SNAPSHOT_MODE=false`.
   - **SU** (Split UGC) — presenter stack; Veo is still a local ffmpeg stand-in.
4. Duration (start with 20s) → **Lock recipe and run**.
5. Job page: wait for PLAN → SCRIPT → ASSEMBLE → COMPOSE → QC. Preview 16:9 / 9:16 / 1:1, download MP4s, then review (keys 1–4).

CLI (same pipeline, no browser):

```bash
pnpm promo -- --title jalebi-har-s01e03 --format SC --duration 20
```

Outputs land in `public/storage/renders/<recipeId>/{16x9,9x16,1x1}.mp4`.

`SNAPSHOT_MODE=false` uses live Vertex / ElevenLabs / ClickHouse / Antaryami when those credentials exist. `SNAPSHOT_MODE=true` forces snapshots (offline). Header pills show which adapters are live.

Antaryami host is `https://antaryami.stage.in/api/v1` (`ANTRYAMI_*` / `ANTARYAMI_*` aliases). Catalogue dialect codes include `har` (mapped to engine `hry`). Episode video files on CMS S3 are private (403); intelligence is still live, and source picture may be a poster stand-in until a signed/streamable proxy exists.

Production-shaped local process (after `pnpm build`):

```bash
pnpm start    # next start + worker
```

## Stack

Docker is optional. Postgres 16 and Redis 7 can run natively.

```bash
pnpm db:migrate
pnpm assets
pnpm db:seed
pnpm test
```

## What you get

Five screens: Library `/`, Title workspace `/t/[titleId]`, Job `/j/[jobId]` (plan, timeline inspector, three-ratio preview, review), Metrics `/metrics`, Dialects `/dialects`.

Thirteen versioned API routes under `/api/v1` plus `GET /api/v1/metrics/summary`.

Formats in this repo: `SC`, `CP`, `SU`. Planner is deterministic (treatment matrix + Five-Beat Spine). ffmpeg composes the three ratios. Live ElevenLabs supplies CP voice-over when enabled.

## Tests that map to §17

- `tests/croppable.test.ts` — computeCroppable, nine shot types
- `tests/safe-area.test.ts` — reserved geometry
- `tests/filtergraph.test.ts` — three golden filtergraphs + stability
- `tests/m2-plan.test.ts` — two-shot 9:16 is composed, not cropped
- `tests/word-budget.test.ts` — dialect pack word budget
- `tests/ppp.test.ts` — PPP tiers + Spearman
- `pnpm e2e:sc` — full SC render for three ratios

## Env

See `.env.example`. Model ids live in `src/config/models.json`, never hardcoded. `pnpm env:check` pings providers without printing secrets.
