#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

PYTHON_BIN=${PYTHON_BIN:-python3.12}

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python interpreter '$PYTHON_BIN' was not found."
  echo "Install Python 3.12+ or rerun with PYTHON_BIN=python3 if you do not need RenderCV yet."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed."
  echo "Run 'corepack enable pnpm' (recommended) or install pnpm globally first."
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Creating virtualenv with $PYTHON_BIN"
  "$PYTHON_BIN" -m venv .venv
fi

echo "Installing Python dependencies"
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install --no-build-isolation -e ".[dev]"

echo "Installing RenderCV"
if .venv/bin/python -m pip install "rendercv[full]"; then
  echo "RenderCV installed successfully"
else
  echo "RenderCV could not be installed in this environment."
  echo "The app can still run, but PDF preview/render will stay unavailable."
fi

echo "Installing frontend dependencies"
pnpm --dir frontend install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Setup complete."
echo "Next:"
echo "1. Update RESUME_WORKSPACE in .env if needed."
echo "2. Run pnpm dev:up"
