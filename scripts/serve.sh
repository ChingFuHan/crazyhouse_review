#!/usr/bin/env bash
# Build the UI and serve UI + API from one process: http://${HOST:-127.0.0.1}:${PORT:-8820}
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -x "$ROOT/engines/fairy-stockfish" ] || "$ROOT/scripts/fetch_engine.sh"
(cd "$ROOT/frontend" && npm install --silent && npm run build)
(cd "$ROOT/backend" && uv sync --quiet)
exec "$ROOT/scripts/run_server.sh"
