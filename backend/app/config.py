"""Runtime settings from environment variables (fixed defaults for local use)."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

from .access import IPNetwork, parse_networks

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


DEFAULT_MODELS = {"anthropic": "claude-opus-5-5", "agy": "gemini-3.8-flash-high"}


@dataclass(frozen=True)
class LLMSettings:
    provider: str  # "anthropic" | "agy" | "fake" | "none"
    model: str
    effort: str
    max_tokens: int
    agy_path: str = "agy"
    agy_timeout_s: float = 180
    # The AI CLIs a viewer may choose from (executable names or paths).
    cli_paths: dict[str, str] | None = None


def llm_settings() -> LLMSettings:
    """LLM_PROVIDER=auto (default): Anthropic if a key is set, else the local agy CLI if installed."""
    agy_path = os.environ.get("AGY_PATH", "agy")
    provider = os.environ.get("LLM_PROVIDER", "auto")
    if provider == "auto":
        if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
            provider = "anthropic"
        elif shutil.which(agy_path):
            provider = "agy"
        else:
            provider = "none"
    return LLMSettings(
        provider=provider,
        model=os.environ.get("LLM_MODEL") or DEFAULT_MODELS.get(provider, ""),
        effort=os.environ.get("LLM_EFFORT", "medium"),
        max_tokens=int(os.environ.get("LLM_MAX_TOKENS", "16000")),
        agy_path=agy_path,
        agy_timeout_s=float(os.environ.get("AGY_TIMEOUT_S", "180")),
        cli_paths={
            "agy": agy_path,
            "codex": os.environ.get("CODEX_PATH", "codex"),
            "claude": os.environ.get("CLAUDE_PATH", "claude"),
        },
    )


def allowed_client_networks() -> list[IPNetwork] | None:
    """ALLOWED_CLIENT_NETWORKS (comma-separated CIDRs); None = no client check (default: the server
    only listens on 127.0.0.1 unless HOST says otherwise). A malformed entry fails at startup."""
    raw = os.environ.get("ALLOWED_CLIENT_NETWORKS", "").strip()
    return parse_networks(raw) if raw else None
