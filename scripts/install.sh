#!/usr/bin/env bash
# Idempotent Cloud Agent / local bootstrap for Localiser.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 -m venv .venv 2>/dev/null || true
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
pip install -e .
python -m playwright install chromium
python -m localiser.cli.main download-fonts || true

if [[ -d web ]]; then
  (cd web && npm ci --ignore-scripts 2>/dev/null || npm install)
fi

# Seed .env from example if missing (never overwrite user secrets)
if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
fi

mkdir -p workspace_data/input workspace_data/projects workspace_data/output
python -c "from localiser.db import init_db; init_db(); print('db ok')"
echo "install complete"
