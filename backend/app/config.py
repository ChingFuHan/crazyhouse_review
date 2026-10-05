"""Runtime settings from environment variables (fixed defaults for local use)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class EngineSettings:
    path: Path
    threads: int
    hash_mb: int
    movetime_ms: int
    max_movetime_ms: int
    multipv: int


def engine_settings() -> EngineSettings:
    return EngineSettings(
        path=Path(os.environ.get("ENGINE_PATH", REPO_ROOT / "engines" / "fairy-stockfish")),
        threads=int(os.environ.get("ENGINE_THREADS", "4")),
        hash_mb=int(os.environ.get("ENGINE_HASH_MB", "256")),
        movetime_ms=int(os.environ.get("ENGINE_MOVETIME_MS", "1500")),
        max_movetime_ms=int(os.environ.get("ENGINE_MAX_MOVETIME_MS", "10000")),
        multipv=int(os.environ.get("ENGINE_MULTIPV", "3")),
    )
