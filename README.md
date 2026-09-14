# STAGE Promo Engine

Source-grounded promotional video production for a regional-language OTT catalogue. One editorial decision, three delivery ratios, measured output quality.

Authoritative spec: the build document in the originating issue. Where code and that document disagree, schemas in `src/domain` win.

## Local run (this machine)

Docker is optional. Postgres 16 and Redis 7 can run natively.

```bash
# infra
sudo service postgresql start
sudo service redis-server start

# app
pnpm install
pnpm db:migrate
pnpm assets
pnpm db:seed
pnpm test
pnpm dev
```

Open http://localhost:3000

`SNAPSHOT_MODE=true` (default in `.env`) runs offline from `data/snapshots/**`. No Vertex / ElevenLabs / Antryami / ClickHouse credentials required.

With Docker instead of native services:

```bash
docker compose up -d
pnpm install && pnpm db:migrate && pnpm assets && pnpm db:seed && pnpm dev
```

## What you get

Five screens: Library `/`, Title workspace `/t/[titleId]`, Job `/j/[jobId]` (plan, timeline inspector, three-ratio preview, review), Metrics `/metrics`, Dialects `/dialects`.

Thirteen versioned API routes under `/api/v1` plus `GET /api/v1/metrics/summary`.

Formats in this repo: `SC`, `CP`, `SU`. Snapshot mode uses a deterministic planner (treatment matrix + Five-Beat Spine) and ffmpeg stand-ins for TTS / Veo.

## Tests that map to §17

- `tests/croppable.test.ts` — computeCroppable, nine shot types
- `tests/safe-area.test.ts` — reserved geometry
- `tests/filtergraph.test.ts` — three golden filtergraphs + stability
- `tests/m2-plan.test.ts` — two-shot 9:16 is composed, not cropped
- `tests/word-budget.test.ts` — dialect pack word budget
- `tests/ppp.test.ts` — PPP tiers + Spearman

## Env

See `.env.example`. Model ids live in `src/config/models.json`, never hardcoded.
