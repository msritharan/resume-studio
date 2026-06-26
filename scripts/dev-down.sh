#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME_DIR="$ROOT_DIR/.runtime"

stop_process() {
  name=$1
  pid_file=$2

  if [ ! -f "$pid_file" ]; then
    echo "$name is not running"
    return 0
  fi

  pid=$(cat "$pid_file")
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name had a stale PID file ($pid)"
    rm -f "$pid_file"
    return 0
  fi

  kill "$pid"

  attempts=0
  while kill -0 "$pid" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 20 ]; then
      echo "Force stopping $name (PID $pid)"
      kill -9 "$pid" 2>/dev/null || true
      break
    fi
    sleep 0.5
  done

  rm -f "$pid_file"
  echo "Stopped $name"
}

stop_process "Frontend" "$RUNTIME_DIR/frontend.pid"
stop_process "Backend" "$RUNTIME_DIR/backend.pid"
