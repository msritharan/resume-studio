#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

export PATH="$ROOT_DIR/.venv/bin:$PATH"

pnpm --dir frontend exec concurrently -n api,ui -c blue,magenta \
  ".venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765" \
  "pnpm --dir frontend dev --host 127.0.0.1 --port 5173"
