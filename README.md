# Localiser — Hindi Manga Localization Studio

Local-first pipeline + review studio that turns foreign-language manga/manhwa pages into:

- **Artifact A:** Localized images with Urban Hinglish (Devanagari) in the original bubbles  
- **Artifact B:** ≥2000-word Hindi prose retelling per chapter  
- **Artifact C:** Locked, versioned Series Bible for cross-chapter consistency  

**Hard rule:** only glyph pixels inside approved masks may change. No generative image models. Pixel-budget assertion runs after every composite.

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11+, FastAPI `:8420`, SQLite, OpenCV, Playwright, Vertex AI |
| Frontend | React 18 + Vite `:5173`, Tailwind, Zustand/TanStack Query |
| Models | **Strictly latest Gemini** — `gemini-3.7-flash` (bulk/dialogue), `gemini-3.1-pro-preview` (bible/story/review) |

## Quick start (local)

```bash
# 1. Python
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
pip install -e .
playwright install chromium
python -m localiser.cli.main download-fonts
cp .env.example .env
# Edit .env — paste Vertex service-account path + GCP_PROJECT

# 2. Doctor (startup checks)
python -m localiser.cli.main doctor

# 3. API
python -m localiser.cli.main serve
# or: uvicorn localiser.api:app --port 8420 --reload

# 4. UI
cd web && npm i && npm run dev
```

Open http://localhost:5173 — add a series by pointing at a folder of chapter subfolders with page images.

### `.env`

```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/vertex-sa.json
GCP_PROJECT=your-project
GCP_LOCATION=asia-south1
WORKSPACE=./workspace_data
```

Vertex is only needed for intelligence stages (detect/OCR/bible/translate/story/chat). Ingest, clean, typeset, and budget checks work offline once fonts + Playwright are installed.

## Pipeline stages

0. **Ingest** → 1. **Detect** (CV + Gemini) → 2. **OCR** + Devanagari gate → 3. **Group/speakers** → 4. **Bible** (human lock) → translate → clean (tiers 1–4) → typeset → story → export

Translate and story **refuse** to run until the Bible is locked.

## Project layout

```
localiser/          # Python package
prompts/            # Versioned Vertex prompts
web/                # React studio UI
assets/fonts/       # Devanagari OFL fonts
tests/              # Incl. NN-2 generative-import ban
workspace_data/     # Local input / projects / output
```

## Tests

```bash
pytest -q
```

## Rights

Set `rights_status` to `owned` / `licensed` / `internal_test`. Export surfaces this so internal-only work does not ship by accident.
