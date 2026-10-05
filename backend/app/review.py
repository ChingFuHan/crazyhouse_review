"""Whole-game review: engine evaluation of every main-line position and critical-move detection.

Runs on its own engine process so a review never supersedes the interactive analysis.
Classification is mate-aware (task.md §30): losing a forced mate or allowing one is flagged
independently of centipawn swings.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
from collections import OrderedDict

from .chess_core import build_board, color_name, position_id
from .engine import EngineService, EngineUnavailable
from .models import Color, EngineLine, ReviewJob, ReviewPly

log = logging.getLogger(__name__)

MAX_JOBS = 8
# Thresholds on the mover's winning-chance drop (scale -1..1), as on lichess.
INACCURACY, MISTAKE, BLUNDER = 0.1, 0.2, 0.3
# Crazyhouse evaluations swing about twice as far as standard-chess ones for a comparable change
# in the game's balance (material in hand, tempo), so centipawns are halved before the standard
# lichess winning-chance curve. Heuristic calibration, observed on real 1-minute games.
CRAZYHOUSE_CP_SCALE = 0.5
# Mate verdicts only matter while the game is still in the balance: a missed mate that keeps an
# overwhelming advantage is an inaccuracy, and allowing mate in an already lost position is not flagged.
DECISIVE = 0.9


def winning_chances(evaluation: float | None, mate: int | None, color: Color) -> float:
    """Winning chances in [-1, 1] for ``color`` from a White-POV score."""
    sign = 1 if color == "white" else -1
    if mate is not None:
        return 1.0 if mate * sign > 0 else -1.0
    cp = (evaluation or 0.0) * 100 * sign * CRAZYHOUSE_CP_SCALE
    return 2 / (1 + math.exp(-0.00368208 * cp)) - 1


def classify(before: EngineLine, after: EngineLine | None, mover: Color, played_best: bool) -> str | None:
    """Judge a move from two searches of the SAME position: ``before`` = best line, ``after`` = the
    played move (searched alone via root_moves). ``after`` is None when the move ended the game."""
    if played_best:
        return None
    sign = 1 if mover == "white" else -1
    mover_mate_before = before.mate is not None and before.mate * sign > 0
    if after is None:
        return None  # the move ended the game (mate or draw); judged by the outcome, not here
    mover_mate_after = after.mate is not None and after.mate * sign > 0
    opponent_mate_after = after.mate is not None and after.mate * sign < 0
    opponent_mate_before = before.mate is not None and before.mate * sign < 0
    chances_before = winning_chances(before.evaluation, before.mate, mover)
    chances_after = winning_chances(after.evaluation, after.mate, mover)
    if mover_mate_before and not mover_mate_after:
        return "inaccuracy" if chances_after >= DECISIVE else "mate_missed"
    if opponent_mate_after and not opponent_mate_before:
        return "mate_allowed" if chances_before > -DECISIVE else None
    drop = chances_before - chances_after
    if drop >= BLUNDER:
        return "blunder"
    if drop >= MISTAKE:
        return "mistake"
    if drop >= INACCURACY:
        return "inaccuracy"
    return None


def job_id(root_fen: str, moves: list[str]) -> str:
    return hashlib.sha256(f"review|{root_fen}|{' '.join(moves)}".encode()).hexdigest()[:16]


class ReviewService:
    def __init__(self, engine: EngineService, movetime_ms: int) -> None:
        self.engine = engine
        self.movetime_ms = movetime_ms
        self._jobs: OrderedDict[str, ReviewJob] = OrderedDict()
        self._tasks: dict[str, asyncio.Task] = {}

    def start(self, root_fen: str, moves: list[str]) -> ReviewJob:
        jid = job_id(root_fen, moves)
        job = self._jobs.get(jid)
        if job is not None and job.status != "error":
            return job
        job = ReviewJob(job_id=jid, root_fen=root_fen, moves=moves, status="running", done=0, total=len(moves) + 1, plies=[])
        self._jobs[jid] = job
        while len(self._jobs) > MAX_JOBS:
            old, _ = self._jobs.popitem(last=False)
            if (task := self._tasks.pop(old, None)) is not None:
                task.cancel()
        self._tasks[jid] = asyncio.create_task(self._run(job))
        return job

    def get(self, jid: str) -> ReviewJob | None:
        return self._jobs.get(jid)

    async def close(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        await self.engine.close()

    async def _run(self, job: ReviewJob) -> None:
        try:
            board = build_board(job.root_fen, [])
            best: list[EngineLine | None] = []
            for ply in range(len(job.moves) + 1):
                line_moves = job.moves[:ply]
                mover = color_name(board.turn)  # before the push: the side that played moves[ply - 1]
                played_line: EngineLine | None = None
                if ply > 0:
                    played = job.moves[ply - 1]
                    previous = best[ply - 1]
                    board.push_uci(played)
                    if previous is not None and previous.pv[0].uci != played and not board.is_game_over():
                        # Score the played move from the SAME position as the best move: both searches
                        # share the side to move, so short-search bias toward the mover cancels out.
                        played_line = await self._line(job.root_fen, line_moves[:-1], (played,))
                pid = position_id(job.root_fen, line_moves)
                best.append(None if board.is_game_over() else await self._line(job.root_fen, line_moves, ()))
                job.plies.append(self._ply(job, ply, pid, best, played_line, mover))
                job.done = ply + 1
            job.status = "done"
        except EngineUnavailable as error:
            job.status, job.error = "error", str(error)
        except Exception as error:  # noqa: BLE001 - surfaced to the client, logged with traceback
            log.exception("review %s failed", job.job_id)
            job.status, job.error = "error", repr(error)

    async def _line(self, root_fen: str, moves: list[str], root_moves: tuple[str, ...]) -> EngineLine | None:
        pid = position_id(root_fen, moves)
        analysis = await self.engine.analyse(root_fen, moves, pid, 1, self.movetime_ms, root_moves)
        return analysis.lines[0] if analysis.lines else None

    def _ply(
        self,
        job: ReviewJob,
        ply: int,
        pid: str,
        best: list[EngineLine | None],
        played_line: EngineLine | None,
        mover: Color,
    ) -> ReviewPly:
        """Evaluation of position ``ply`` and the verdict on the move that led to it (played by ``mover``)."""
        line = best[ply]
        entry = ReviewPly(
            ply=ply,
            position_id=pid,
            evaluation=line.evaluation if line else None,
            mate=line.mate if line else None,
            best_move=line.pv[0].san if line else None,
        )
        before = best[ply - 1] if ply > 0 else None
        if before is None:
            return entry
        entry.played_best = before.pv[0].uci == job.moves[ply - 1]
        entry.best_before = before.pv[0].san
        if played_line is not None:
            entry.played_evaluation, entry.played_mate = played_line.evaluation, played_line.mate
        entry.classification = classify(before, played_line, mover, entry.played_best)
        return entry
