# Localiser — ChitraKatha Hindi Manga Localization Studio

**Localiser** is a local-first pipeline + review studio that converts a foreign-language
manga / manhwa / webtoon image set into:

- **Artifact A** — Localized images with Hindi (Urban Hinglish, Devanagari) dialogue typeset
  into the original bubbles.
- **Artifact B** — A long-form Hindi prose retelling of each chapter (≥ 2000 words),
  culturally localized to India.
- **Artifact C** — A locked, versioned Series Bible guaranteeing cross-chapter consistency.

Everything runs on your machine. The only network dependency is **Vertex AI** (Gemini),
used strictly for text/vision intelligence — **no generative image model ever touches the
pages** (enforced by a real unit test, see `tests/test_no_generative_imports.py`).

## The big rule

> Image mein text ke alawa **kuch bhi** nahi badlega.

Every composite build runs a **pixel budget assertion**: any pixel outside the approved
text masks must be byte-identical to the original, or the build is rejected and rolled
back. See `localiser/pipeline/budget.py`.

## Models (strictly latest)

Defaults (August 2026, editable in `series.json` / `localiser/config.py`):

| Purpose      | Model                   |
|--------------|-------------------------|
| vision_bulk  | `gemini-3.7-flash`      |
| vision_deep  | `gemini-3.1-pro-preview`|
| story        | `gemini-3.1-pro-preview`|
| dialogue     | `gemini-3.7-flash`      |
| review       | `gemini-3.1-pro-preview`|

A fallback chain is applied automatically if a model is not available in your region
(`gemini-3.7-flash → gemini-3.6-flash → gemini-3.5-flash`). `python -m localiser.cli doctor`
verifies model availability in the configured region and reports the resolved IDs.

## Setup

```bash
# backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env                                  # then edit values
python -m localiser.cli doctor                        # runs ALL startup checks

# frontend
cd web && npm install && npm run dev                  # http://localhost:5173

# run backend
uvicorn localiser.api:app --port 8420 --reload
```

### .env

```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/vertex-sa.json
GCP_PROJECT=your-project
GCP_LOCATION=asia-south1
WORKSPACE=/path/to/localiser-workspace
```

### Fonts

Drop these OFL fonts into `assets/fonts/` (all free on Google Fonts):
Mukta (Regular / SemiBold / ExtraBold), Kalam (Regular / Bold), Yatra One, Baloo 2.
`doctor` checks each font file for Devanagari coverage.

## Layout

```
localiser/            backend package (FastAPI on :8420)
  ai/                 Vertex client (retry, cache, cost log, model fallback)
  pipeline/           stages 0–9: ingest → detect → ocr → group → bible →
                      translate → clean → typeset → story → export
  patch/              chat/notes → structured patch ops → minimal rebuild
  prompts/            versioned prompt files (P-DETECT … P-CHAT-INTENT)
web/                  React 18 + Vite + TS + Tailwind review studio (:5173)
tests/                unit tests incl. the NN-1 / NN-2 enforcement tests
assets/fonts/         Devanagari fonts (user-supplied, OFL)
assets/qa/            golden shaping image
```

## Workspace on disk

```
<WORKSPACE>/
├── input/<Series Title>/Chapter 01/*.png        # read-only source
├── projects/<series-slug>/                      # bible, tm, chapters, layers
└── output/<Series Title>/                       # export target
```

Originals are immutable; all edits are RGBA layers
(`original ⊕ clean_layer ⊕ text_layer = composite`), every state revertable.

## Rights

The pipeline records source paths and never removes credit regions. Set
`series.rights_status` (`owned` / `licensed` / `internal_test`) honestly — the Export
screen surfaces it and blocks accidental shipping of internal-only work.
