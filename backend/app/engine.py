"""Fairy-Stockfish adapter: one engine process, one analysis at a time.

All evaluations leave this module normalized to White's point of view.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections import OrderedDict

import chess
import chess.engine
from chess.variant import CrazyhouseBoard

from .chess_core import build_board, move_model
from .config import EngineSettings
from .models import EngineAnalysis, EngineLine, MoveModel

log = logging.getLogger(__name__)

CACHE_SIZE = 512
# Extra wall-clock allowance over the requested movetime before the engine is declared hung.
TIMEOUT_MARGIN_S = 5.0


class EngineUnavailable(RuntimeError):
    """The engine binary is missing or the process cannot be (re)started."""


def normalize_line(board: CrazyhouseBoard, info: chess.engine.InfoDict, rank: int) -> EngineLine | None:
    """Convert one MultiPV slot to a White-POV line with machine + display moves."""
    score = info.get("score")
    pv = info.get("pv")
    if score is None or not pv:
        return None
    white = score.white()
    mate = white.mate()
    moves: list[MoveModel] = []
    line_board = board.copy(stack=False)
    for move in pv:
        if not line_board.is_legal(move):
            log.warning("engine PV contains illegal move %s in %s", move.uci(), line_board.fen())
            break
        moves.append(move_model(line_board, move))
        line_board.push(move)
    if not moves:
        return None
    return EngineLine(
        rank=rank,
        evaluation=None if mate is not None else round(white.score() / 100, 2),
        mate=mate,
        depth=info.get("depth", 0),
        pv=moves,
    )


def analysis_id(position_id: str, engine: str, lines: list[EngineLine]) -> str:
    """Identity of an engine result: changes whenever the analysis content changes."""
    content = json.dumps(
        [position_id, engine, [[l.rank, l.evaluation, l.mate, l.depth, [m.uci for m in l.pv]] for l in lines]]
    )
    return hashlib.sha256(content.encode()).hexdigest()[:16]


class EngineService:
    def __init__(self, settings: EngineSettings) -> None:
        self.settings = settings
        self.name = "Fairy-Stockfish"
        self._engine: chess.engine.UciProtocol | None = None
        self._lock = asyncio.Lock()
        self._generation = 0
        self._running: chess.engine.AnalysisResult | None = None
        self._cache: OrderedDict[tuple[str, int, int], EngineAnalysis] = OrderedDict()

    async def _ensure_started(self) -> chess.engine.UciProtocol:
        if self._engine is not None and not self._engine.returncode.done():
            return self._engine
        if not self.settings.path.exists():
            raise EngineUnavailable(f"engine not found at {self.settings.path}; run scripts/fetch_engine.sh")
        try:
            _, engine = await chess.engine.popen_uci(str(self.settings.path))
            await engine.configure({"Threads": self.settings.threads, "Hash": self.settings.hash_mb})
        except (OSError, chess.engine.EngineError) as error:
            raise EngineUnavailable(f"cannot start engine: {error}") from error
        if "crazyhouse" not in engine.options["UCI_Variant"].var:
            await engine.quit()
            raise EngineUnavailable("engine does not support the crazyhouse variant")
        self.name = engine.id.get("name", self.name)
        self._engine = engine
        return engine

    async def _restart(self) -> None:
        engine, self._engine = self._engine, None
        if engine is not None:
            try:
                await asyncio.wait_for(engine.quit(), timeout=2)
            except Exception:  # noqa: BLE001 - the process is being discarded anyway
                log.exception("engine did not quit cleanly")

    async def close(self) -> None:
        await self._restart()

    async def analyse(
        self, root_fen: str, moves: list[str], position_id: str, multipv: int, movetime_ms: int
    ) -> EngineAnalysis:
        key = (position_id, multipv, movetime_ms)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key].model_copy(update={"cached": True})

        # A newer request supersedes the running one: stop it so the lock frees quickly.
        self._generation += 1
        generation = self._generation
        if self._running is not None:
            self._running.stop()

        async with self._lock:
            if generation != self._generation:
                return self._cancelled(position_id, multipv, movetime_ms)
            engine = await self._ensure_started()
            board = build_board(root_fen, moves)
            try:
                analysis = await engine.analysis(
                    board,
                    chess.engine.Limit(time=movetime_ms / 1000),
                    multipv=multipv,
                    info=chess.engine.INFO_SCORE | chess.engine.INFO_PV | chess.engine.INFO_BASIC,
                )
                self._running = analysis
                if generation != self._generation:
                    analysis.stop()  # superseded while the search was being started
                await asyncio.wait_for(analysis.wait(), timeout=movetime_ms / 1000 + TIMEOUT_MARGIN_S)
            except (TimeoutError, chess.engine.EngineError, chess.engine.EngineTerminatedError) as error:
                log.error("engine failure, restarting: %r", error)
                await self._restart()
                raise EngineUnavailable(f"engine failed: {error!r}") from error
            finally:
                self._running = None

            lines = [line for rank, info in enumerate(analysis.multipv, 1) if (line := normalize_line(board, info, rank))]
            superseded = generation != self._generation
            result = EngineAnalysis(
                position_id=position_id,
                status="cancelled" if superseded else "ok",
                engine=self.name,
                multipv=multipv,
                movetime_ms=movetime_ms,
                depth=max((line.depth for line in lines), default=0),
                lines=lines,
                best_move=lines[0].pv[0] if lines else None,
                analysis_id=analysis_id(position_id, self.name, lines),
            )
            if not superseded and lines:
                self._cache[key] = result
                if len(self._cache) > CACHE_SIZE:
                    self._cache.popitem(last=False)
            return result

    def _cancelled(self, position_id: str, multipv: int, movetime_ms: int) -> EngineAnalysis:
        return EngineAnalysis(
            position_id=position_id,
            status="cancelled",
            engine=self.name,
            multipv=multipv,
            movetime_ms=movetime_ms,
            depth=0,
            lines=[],
            best_move=None,
            analysis_id=analysis_id(position_id, self.name, []),
        )
