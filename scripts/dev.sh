#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
  .venv/bin/pip install -e .
  .venv/bin/playwright install chromium
  .venv/bin/python -m localiser.cli.main download-fonts
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m localiser.cli.main doctor || true
uvicorn localiser.api:app --port 8420 --reload &
API_PID=$!
(cd web && npm run dev) &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null || true' EXIT
wait
