"""Fairy-Stockfish adapter: one engine process, one analysis at a time.

All evaluations leave this module normalized to White's point of view.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
from collections import OrderedDict
from collections.abc import AsyncIterator

import chess
import chess.engine
from chess.variant import CrazyhouseBoard

from .chess_core import build_board, move_model
from .config import EngineSettings
from .models import EngineAnalysis, EngineLine, MoveModel, SearchSettings

log = logging.getLogger(__name__)

CACHE_SIZE = 512
# Streamed snapshots and final results, by analysis_id, so explanations can use exactly what is shown.
REMEMBERED = 512
SNAPSHOT_INTERVAL_S = 0.25
# "Infinite" analysis still ends after this long (the engine is shared by everyone on the LAN).
INFINITE_CAP_S = 600
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


def _stop_when_started(starting: asyncio.Future[chess.engine.AnalysisResult]) -> None:
    if not starting.cancelled() and starting.exception() is None:
        starting.result().stop()


class EngineService:
    def __init__(self, settings: EngineSettings) -> None:
        self.settings = settings
        self.name = "Fairy-Stockfish"
        self._engine: chess.engine.UciProtocol | None = None
        self._lock = asyncio.Lock()
        # Bumped whenever a request arrives for a different position than the previous one;
        # a search that sees the generation change was stopped (or is stale) and is "cancelled".
        self._generation = 0
        self._latest_position: str | None = None
        self._running: chess.engine.AnalysisResult | None = None
        self._running_protected = False
        self._running_position: str | None = None
        self._remembered: OrderedDict[str, EngineAnalysis] = OrderedDict()
        self._cache: OrderedDict[tuple, EngineAnalysis] = OrderedDict()
        # Identical requests share one search instead of superseding each other.
        self._inflight: dict[tuple, asyncio.Future[EngineAnalysis]] = {}
        # The start of a search whose stream was cancelled meanwhile (see stream()).
        self._abandoned: asyncio.Future[chess.engine.AnalysisResult] | None = None

    async def _ensure_started(self) -> chess.engine.UciProtocol:
        if self._abandoned is not None:
            # No new command may reach python-chess while an abandoned search is still starting: it
            # would cancel that start, and python-chess would then begin the search anyway, with
            # nobody left to stop it. Once started, the search is stopped at once.
            with contextlib.suppress(Exception):
                await asyncio.wait_for(asyncio.shield(self._abandoned), timeout=TIMEOUT_MARGIN_S)
            self._abandoned = None
        if self._engine is not None and not self._engine.returncode.done():
            return self._engine
        if not self.settings.path.exists():
            raise EngineUnavailable(f"engine not found at {self.settings.path}; run scripts/fetch_engine.sh")
        options: dict[str, str | int] = {"Threads": self.settings.threads, "Hash": self.settings.hash_mb}
        if self.settings.eval_file is not None:
            if not self.settings.eval_file.exists():
                raise EngineUnavailable(f"NNUE file not found at {self.settings.eval_file}; run scripts/fetch_engine.sh")
            options["EvalFile"] = str(self.settings.eval_file)
        try:
            _, engine = await chess.engine.popen_uci(str(self.settings.path))
            await engine.configure(options)
        except (OSError, chess.engine.EngineError) as error:
            raise EngineUnavailable(f"cannot start engine: {error}") from error
        if "crazyhouse" not in engine.options["UCI_Variant"].var:
            await engine.quit()
            raise EngineUnavailable("engine does not support the crazyhouse variant")
        # The evaluation mode is part of the name, so results (and analysis_id) of the two never mix.
        self.name = engine.id.get("name", self.name) + (" NNUE" if self.settings.eval_file else " classical")
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
        self,
        root_fen: str,
        moves: list[str],
        position_id: str,
        multipv: int,
        movetime_ms: int,
        root_moves: tuple[str, ...] = (),
        protected: bool = False,
        depth: int | None = None,
    ) -> EngineAnalysis:
        """``root_moves`` (UCI) restricts the search to those moves (UCI ``searchmoves``); ``depth``
        additionally caps the search depth (the search stops at whichever limit comes first).

        ``protected`` searches (asked for explicitly by the user, e.g. an explanation) take no part in
        superseding: they never stop other searches and are never stopped; they only queue.
        """
        key = (position_id, multipv, movetime_ms, root_moves, depth)
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key].model_copy(update={"cached": True})
        args = (root_fen, moves, position_id, multipv, movetime_ms, root_moves, depth)
        shared = self._inflight.get(key) or self._start(key, args, protected)
        # shield: a caller going away must not cancel a search others are waiting for.
        result = await asyncio.shield(shared)
        if protected and result.status == "cancelled":
            result = await asyncio.shield(self._start(key, args, protected=True))  # joined a superseded search
        return result

    def _start(self, key: tuple, args: tuple, protected: bool) -> asyncio.Future[EngineAnalysis]:
        shared = asyncio.ensure_future(self._search(*args, protected=protected))
        self._inflight[key] = shared
        shared.add_done_callback(lambda done: self._inflight.pop(key, None) if self._inflight.get(key) is done else None)
        return shared

    async def _search(
        self,
        root_fen: str,
        moves: list[str],
        position_id: str,
        multipv: int,
        movetime_ms: int,
        root_moves: tuple[str, ...],
        depth: int | None,
        protected: bool = False,
    ) -> EngineAnalysis:
        key = (position_id, multipv, movetime_ms, root_moves, depth)
        # A request for another position supersedes the running search: stop it so the lock frees quickly.
        if not protected and position_id != self._latest_position:
            self._latest_position = position_id
            self._generation += 1
            if self._running is not None and not self._running_protected:
                self._running.stop()
        # Same position, other settings (e.g. quick look vs. full search): queue, never cancel.
        generation = self._generation

        async with self._lock:
            if not protected and generation != self._generation:
                return self._cancelled(position_id, multipv, movetime_ms)
            engine = await self._ensure_started()
            board = build_board(root_fen, moves)
            try:
                # A streamed search may have left other Threads/Hash: these searches use the defaults.
                await engine.configure({"Threads": self.settings.threads, "Hash": self.settings.hash_mb})
                analysis = await engine.analysis(
                    board,
                    chess.engine.Limit(time=movetime_ms / 1000, depth=depth),
                    multipv=multipv,
                    info=chess.engine.INFO_SCORE | chess.engine.INFO_PV | chess.engine.INFO_BASIC,
                    root_moves=[chess.Move.from_uci(uci) for uci in root_moves] or None,
                )
                self._running, self._running_protected = analysis, protected
                if not protected and generation != self._generation:
                    analysis.stop()  # superseded while the search was being started
                await asyncio.wait_for(analysis.wait(), timeout=movetime_ms / 1000 + TIMEOUT_MARGIN_S)
            except (TimeoutError, chess.engine.EngineError, chess.engine.EngineTerminatedError) as error:
                log.error("engine failure, restarting: %r", error)
                await self._restart()
                raise EngineUnavailable(f"engine failed: {error!r}") from error
            finally:
                self._running = None

            lines = [line for rank, info in enumerate(analysis.multipv, 1) if (line := normalize_line(board, info, rank))]
            superseded = not protected and generation != self._generation
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
            self._remember(result)
            return result

    def _remember(self, result: EngineAnalysis) -> None:
        self._remembered[result.analysis_id] = result
        self._remembered.move_to_end(result.analysis_id)
        while len(self._remembered) > REMEMBERED:
            self._remembered.popitem(last=False)

    def find(self, analysis_id: str) -> EngineAnalysis | None:
        """A result (final or streamed snapshot) this engine produced recently."""
        return self._remembered.get(analysis_id)

    def stop(self, position_id: str) -> bool:
        """Finish the streamed search of this position now; its result counts as complete."""
        if self._running is None or self._running_protected or self._running_position != position_id:
            return False
        self._running.stop()
        return True

    async def stream(
        self, root_fen: str, moves: list[str], position_id: str, settings: SearchSettings
    ) -> AsyncIterator[EngineAnalysis]:
        """Search with the user's settings, yielding `running` snapshots as the search deepens and then
        one final result: `ok` (depth/time reached or stopped) or `cancelled` (another position came)."""
        key = ("stream", position_id, settings.multipv, settings.movetime_ms, settings.depth, settings.threads, settings.hash_mb)
        if key in self._cache:
            self._cache.move_to_end(key)
            yield self._cache[key].model_copy(update={"cached": True})
            return
        if position_id != self._latest_position:
            self._latest_position = position_id
            self._generation += 1
            if self._running is not None and not self._running_protected:
                self._running.stop()
        generation = self._generation
        seconds = (settings.movetime_ms / 1000) if settings.movetime_ms else INFINITE_CAP_S

        async with self._lock:
            if generation != self._generation:
                yield self._cancelled(position_id, settings.multipv, settings.movetime_ms)
                return
            engine = await self._ensure_started()
            board = build_board(root_fen, moves)
            loop = asyncio.get_running_loop()
            try:
                await engine.configure({"Threads": settings.threads, "Hash": settings.hash_mb})
                started = loop.time()
                starting = asyncio.ensure_future(
                    engine.analysis(
                        board,
                        chess.engine.Limit(time=seconds, depth=settings.depth),
                        multipv=settings.multipv,
                        info=chess.engine.INFO_SCORE | chess.engine.INFO_PV | chess.engine.INFO_BASIC,
                    )
                )
                try:
                    analysis = await asyncio.shield(starting)
                except asyncio.CancelledError:
                    # The client left while the search was starting. Cancelling the start itself would
                    # not help: python-chess still sends `go` once the engine is ready, leaving a
                    # search nobody stops. Let it start, then stop it at once.
                    starting.add_done_callback(_stop_when_started)
                    self._abandoned = starting
                    raise
            except (chess.engine.EngineError, chess.engine.EngineTerminatedError) as error:
                await self._restart()
                raise EngineUnavailable(f"engine failed: {error!r}") from error
            self._running, self._running_protected, self._running_position = analysis, False, position_id
            if generation != self._generation:
                analysis.stop()
            finished = False
            try:
                last_emit, last_depth = 0.0, 0
                deadline = started + seconds + TIMEOUT_MARGIN_S
                while True:
                    try:
                        info = await asyncio.wait_for(analysis.next(), timeout=max(0.1, deadline - loop.time()))
                    except TimeoutError:
                        analysis.stop()
                        info = await asyncio.wait_for(analysis.next(), timeout=TIMEOUT_MARGIN_S)
                    if info is None:
                        break
                    now = loop.time()
                    snapshot = None
                    depth = info.get("depth", 0)
                    if now - last_emit >= SNAPSHOT_INTERVAL_S or depth > last_depth:
                        snapshot = self._snapshot(board, analysis, position_id, settings, "running", now - started)
                    if snapshot is not None and snapshot.lines:
                        last_emit, last_depth = now, max(last_depth, depth)
                        self._remember(snapshot)
                        yield snapshot
                finished = True
            except (chess.engine.EngineError, chess.engine.EngineTerminatedError, TimeoutError) as error:
                log.error("engine failure during stream, restarting: %r", error)
                await self._restart()
                raise EngineUnavailable(f"engine failed: {error!r}") from error
            finally:
                if not finished and self._engine is not None:
                    # The client went away or the stream failed: stop the search and let it wind down.
                    analysis.stop()
                    try:
                        await asyncio.shield(asyncio.wait_for(analysis.wait(), timeout=TIMEOUT_MARGIN_S))
                    except Exception:  # noqa: BLE001 - discard the process rather than leave it searching
                        await self._restart()
                self._running, self._running_position = None, None

            superseded = generation != self._generation
            result = self._snapshot(
                board, analysis, position_id, settings, "cancelled" if superseded else "ok", loop.time() - started
            )
            self._remember(result)
            # An infinite analysis is never served from the cache: coming back resumes searching
            # (the hash table makes it reach the previous depth quickly), like lichess.
            if not superseded and result.lines and settings.movetime_ms is not None:
                self._cache[key] = result
                if len(self._cache) > CACHE_SIZE:
                    self._cache.popitem(last=False)
            yield result

    def _snapshot(
        self,
        board,
        analysis: chess.engine.AnalysisResult,
        position_id: str,
        settings: SearchSettings,
        status: str,
        elapsed_s: float,
    ) -> EngineAnalysis:
        lines = [line for rank, info in enumerate(analysis.multipv, 1) if (line := normalize_line(board, info, rank))]
        first = analysis.multipv[0] if analysis.multipv else {}
        return EngineAnalysis(
            position_id=position_id,
            status=status,  # type: ignore[arg-type]
            engine=self.name,
            multipv=settings.multipv,
            movetime_ms=settings.movetime_ms,
            depth=max((line.depth for line in lines), default=0),
            lines=lines,
            best_move=lines[0].pv[0] if lines else None,
            analysis_id=analysis_id(position_id, self.name, lines),
            nodes=first.get("nodes"),
            nps=first.get("nps"),
            elapsed_ms=int(elapsed_s * 1000),
            settings=settings,
        )

    def _cancelled(self, position_id: str, multipv: int, movetime_ms: int | None) -> EngineAnalysis:
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
