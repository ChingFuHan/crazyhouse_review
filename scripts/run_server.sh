#!/usr/bin/env bash
# Run the backend (API + built UI in frontend/dist). Listens on 127.0.0.1 unless HOST is set,
# e.g. HOST=0.0.0.0 with ALLOWED_CLIENT_NETWORKS restricting who may connect.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
exec uv run uvicorn app.main:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8820}"
