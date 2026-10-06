"""Runtime settings from environment variables (fixed defaults for local use)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
# Crazyhouse NNUE for Fairy-Stockfish (+1136 Elo over the classical eval); fetched by
# scripts/fetch_engine.sh. The hash in the name is the start of the file's sha256.
DEFAULT_EVAL_FILE = REPO_ROOT / "engines" / "crazyhouse-8ebf84784ad2.nnue"


@dataclass(frozen=True)
class EngineSettings:
    path: Path
    threads: int
    hash_mb: int
    movetime_ms: int
    max_movetime_ms: int
    multipv: int
    # Search time for "what if the side to move passed?" threat analysis.
    threat_movetime_ms: int = 400
    # NNUE network; None = Fairy-Stockfish's classical evaluation.
    eval_file: Path | None = None


def engine_settings() -> EngineSettings:
    return EngineSettings(
        path=Path(os.environ.get("ENGINE_PATH", REPO_ROOT / "engines" / "fairy-stockfish")),
        threads=int(os.environ.get("ENGINE_THREADS", "4")),
        hash_mb=int(os.environ.get("ENGINE_HASH_MB", "256")),
        movetime_ms=int(os.environ.get("ENGINE_MOVETIME_MS", "1500")),
        max_movetime_ms=int(os.environ.get("ENGINE_MAX_MOVETIME_MS", "10000")),
        multipv=int(os.environ.get("ENGINE_MULTIPV", "3")),
        threat_movetime_ms=int(os.environ.get("THREAT_MOVETIME_MS", "400")),
        eval_file=_eval_file(),
    )


def _eval_file() -> Path | None:
    """ENGINE_EVAL_FILE overrides (empty = classical eval); default: the bundled net if fetched."""
    configured = os.environ.get("ENGINE_EVAL_FILE")
    if configured is not None:
        return Path(configured) if configured else None
    return DEFAULT_EVAL_FILE if DEFAULT_EVAL_FILE.exists() else None


def review_engine_settings() -> EngineSettings:
    """A second, smaller engine process for whole-game review (never competes with interactive analysis)."""
    base = engine_settings()
    return EngineSettings(
        path=base.path,
        threads=int(os.environ.get("REVIEW_ENGINE_THREADS", "2")),
        hash_mb=int(os.environ.get("REVIEW_ENGINE_HASH_MB", "64")),
        movetime_ms=int(os.environ.get("REVIEW_MOVETIME_MS", "300")),
        max_movetime_ms=base.max_movetime_ms,
        multipv=1,
        eval_file=base.eval_file,
    )


@dataclass(frozen=True)
class LLMSettings:
    provider: str  # "anthropic" | "fake" | "none"
    model: str
    effort: str
    max_tokens: int


def llm_settings() -> LLMSettings:
    return LLMSettings(
        provider=os.environ.get("LLM_PROVIDER", "anthropic"),
        model=os.environ.get("LLM_MODEL", "claude-opus-5-5"),
        effort=os.environ.get("LLM_EFFORT", "medium"),
        max_tokens=int(os.environ.get("LLM_MAX_TOKENS", "16000")),
    )
