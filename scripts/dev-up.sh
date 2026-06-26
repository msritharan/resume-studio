#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME_DIR="$ROOT_DIR/.runtime"
BACKEND_PID_FILE="$RUNTIME_DIR/backend.pid"
FRONTEND_PID_FILE="$RUNTIME_DIR/frontend.pid"
BACKEND_LOG="$RUNTIME_DIR/backend.log"
FRONTEND_LOG="$RUNTIME_DIR/frontend.log"

cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

mkdir -p "$RUNTIME_DIR"

ensure_port_free() {
  port=$1
  name=$2

  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$name port $port is already in use by PID(s): $pids"
    exit 1
  fi
}

ensure_not_running() {
  name=$1
  pid_file=$2

  if [ ! -f "$pid_file" ]; then
    return 0
  fi

  pid=$(cat "$pid_file")
  if kill -0 "$pid" 2>/dev/null; then
    echo "$name is already running with PID $pid"
    exit 1
  fi

  rm -f "$pid_file"
}

start_process() {
  name=$1
  pid_file=$2
  log_file=$3
  shift 3

  nohup "$@" >"$log_file" 2>&1 &
  pid=$!

  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Failed to start $name. Check $log_file"
    return 1
  fi

  echo "$pid" >"$pid_file"
  echo "Started $name (PID $pid)"
}

cleanup_started_processes() {
  for pid_file in "$FRONTEND_PID_FILE" "$BACKEND_PID_FILE"; do
    if [ ! -f "$pid_file" ]; then
      continue
    fi

    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  done
}

ensure_not_running "Backend" "$BACKEND_PID_FILE"
ensure_not_running "Frontend" "$FRONTEND_PID_FILE"
ensure_port_free 8765 "Backend"
ensure_port_free 5173 "Frontend"

if [ ! -x .venv/bin/python ]; then
  echo "Missing virtualenv interpreter at .venv/bin/python"
  echo "Bootstrapping project dependencies with ./scripts/setup.sh"
  ./scripts/setup.sh
fi

if ! .venv/bin/python -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "Python dependencies are missing from .venv."
  echo "Run ./scripts/setup.sh first."
  exit 1
fi

export PATH="$ROOT_DIR/.venv/bin:$PATH"

if ! .venv/bin/python -c "import rendercv" >/dev/null 2>&1; then
  echo "Warning: RenderCV is not installed in .venv."
  echo "The app will start, but PDF preview/render will be unavailable."
fi

start_process \
  "Backend" \
  "$BACKEND_PID_FILE" \
  "$BACKEND_LOG" \
  .venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765

if ! start_process \
  "Frontend" \
  "$FRONTEND_PID_FILE" \
  "$FRONTEND_LOG" \
  pnpm --dir frontend dev --host 127.0.0.1 --port 5173; then
  cleanup_started_processes
  exit 1
fi

echo "Resume Studio is starting up."
echo "App UI:    http://127.0.0.1:5173"
echo "API:       http://127.0.0.1:8765"
echo "Logs: $RUNTIME_DIR"
