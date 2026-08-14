# Localiser

Local-first Hindi manga localization studio for ArTribe Toons. Source manga
stays immutable; generated work lives under a separate workspace.

## Implemented foundation

- FastAPI + SQLite local backend
- Lossless ingest with natural sorting, decimal chapters, duplicate detection,
  format detection, immutable originals, and rejected-file reporting
- React manga-workshop library UI
- RGBA composition with a strict pixel change-budget assertion
- Configurable Vertex Gemini client with bounded concurrency and retries
- Local diagnostics through `localiser doctor`

Detection, Bible, translation, cleaning, Devanagari typesetting, story, review,
and export remain subsequent build phases. This repository does not claim those
stages are complete.

## macOS setup

Python 3.11+ and Node 20+ are required.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev,vertex]'
cp .env.example .env
```

Open `.env` locally and set the service-account JSON path, project, region, and
workspace. Do not paste the JSON contents into chat and never commit `.env`.

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=/Users/you/keys/vertex-localiser.json
GCP_PROJECT=your-project
GCP_LOCATION=asia-south1
LOCALISER_WORKSPACE=/Users/you/LocaliserWorkspace
```

Model IDs also live in `.env`. Use models actually available in the selected
Vertex region; a “latest” alias is not guaranteed to exist in every region.

```bash
localiser doctor
```

Install and start the UI:

```bash
cd web
npm install
npm run dev
```

In another terminal:

```bash
source .venv/bin/activate
localiser serve
```

Open <http://127.0.0.1:5173>. Both services bind to loopback only.

## Verification

```bash
pytest
cd web && npm run build
```

## Safety boundary

`original.png` is read-only after ingest. Composite output is rebuilt from the
original, clean layer, and text layer. Both layers must have zero alpha outside
`masks/budget.png`; afterward the composite is byte-compared to the original
outside that mask. A mismatch raises `BudgetViolation` and prevents output.
