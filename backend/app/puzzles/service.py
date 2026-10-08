"""The puzzle page's backend: choosing puzzles, judging answers and battles, ratings, export, jobs."""

from __future__ import annotations

import asyncio
import logging
import random
import uuid
from collections import OrderedDict

import chess

from ..chess_core import IllegalMoveError, LineError, build_board, color_name, move_model, normalize_root_fen, parse_move
from ..models import ExportNode, MoveModel
from ..pgn_import import export_pgn
from .generator import generate
from .miner import MIDDLEGAME_PLY, Miner, chances
from .models import (
    PUZZLE_TYPES,
    TYPE_NAMES,
    BattleMoveResult,
    Hint,
    MoveResult,
    Player,
    Puzzle,
    PuzzleExport,
    PuzzleJob,
    PuzzleType,
    PuzzleView,
    RatingChange,
)
from .rating import Rating, play
from .store import PuzzleStore

log = logging.getLogger(__name__)

MAX_JOBS = 20
# Battle verdicts on the solver's drop in winning chances (the whole-game review's thresholds).
VERDICTS = ((0.3, "blunder"), (0.2, "mistake"), (0.1, "inaccuracy"), (0.02, "good"))
BATTLE_MARGIN = 0.2  # final chances vs start: beyond = won / lost, within = held


class PuzzleError(ValueError):
    """A request about a puzzle that cannot be honoured; the message is for the user."""


def lichess_fen(fen: str) -> str:
    """lichess writes crazyhouse pockets after the board as a ninth rank ("…/RNBQKBNR/Pp w …")."""
    board, rest = fen.split(" ", 1)
    if "[" in board:
        squares, pocket = board[:-1].split("[")
        board = f"{squares}/{pocket}"
    return f"{board} {rest}"


class PuzzleService:
    def __init__(self, store: PuzzleStore, miner: Miner, openings: list[tuple[str, list[str]]]) -> None:
        self.store = store
        self.miner = miner
        self.openings = openings
        self._jobs: OrderedDict[str, PuzzleJob] = OrderedDict()
        self._tasks: dict[str, asyncio.Task] = {}

    async def close(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        self.store.close()
        await self.miner.engine.close()

    # --- players and puzzles ---------------------------------------------------------------------

    def player(self, nickname: str, create: bool = False) -> tuple[int, Player]:
        found = self.store.player(nickname.strip(), create=create)
        if found is None:
            raise PuzzleError(f"找不到玩家「{nickname}」，請先登入")
        return found

    def view(self, puzzle: Puzzle, player_id: int | None) -> PuzzleView:
        return PuzzleView(
            id=puzzle.id,
            type=puzzle.type,
            type_name=TYPE_NAMES[puzzle.type],
            fen=puzzle.fen,
            solver=puzzle.solver,
            solver_moves=(len(puzzle.solution) + 1) // 2 if puzzle.type != "battle" else None,
            battle_plies=puzzle.battle_plies,
            rating=round(puzzle.rating),
            plays=puzzle.plays,
            themes=puzzle.themes,
            rated=player_id is None or not self.store.attempted(player_id, puzzle.id),
        )

    def next(self, nickname: str, types: list[PuzzleType]) -> PuzzleView:
        player_id, player = self.player(nickname)
        puzzle = self.store.next_for(player_id, player.rating, types or list(PUZZLE_TYPES))
        if puzzle is None:
            raise PuzzleError("題庫裡還沒有這類題目：請先從對局挖題或製造新題")
        return self.view(puzzle, player_id)

    def _puzzle(self, puzzle_id: int) -> Puzzle:
        puzzle = self.store.get(puzzle_id)
        if puzzle is None:
            raise PuzzleError("找不到這一題")
        return puzzle

    def _rate(self, player_id: int, player: Player, puzzle: Puzzle, score: float) -> RatingChange:
        before = Rating(player.rating, player.rd, player.vol)
        old = Rating(puzzle.rating, puzzle.rd, puzzle.vol)
        new_player, new_puzzle = play(before, old, score)
        rated = self.store.record(player_id, before, puzzle, new_player, new_puzzle, score)
        if not rated:
            new_player, new_puzzle = before, old
        return RatingChange(
            rated=rated, score=score, before=round(before.rating), after=round(new_player.rating),
            puzzle_before=round(old.rating), puzzle_after=round(new_puzzle.rating),
        )  # fmt: skip

    # --- solving ---------------------------------------------------------------------------------

    def _line_board(self, puzzle: Puzzle, moves: list[str]) -> chess.Board:
        if moves != puzzle.solution[: len(moves)] or len(moves) % 2:
            raise PuzzleError("作答進度與題目不符，請重新開始這一題")
        return build_board(puzzle.fen, moves)

    def _models(self, fen: str, moves: list[str]) -> list[MoveModel]:
        board = build_board(fen, [])
        out = []
        for uci in moves:
            move = chess.Move.from_uci(uci)
            out.append(move_model(board, move))
            board.push(move)
        return out

    def move(self, puzzle_id: int, nickname: str, moves: list[str], answer: str, hint_used: bool) -> MoveResult:
        """Judge one solver move: the solution's move, or on the last step any move that mates."""
        puzzle = self._puzzle(puzzle_id)
        if puzzle.type == "battle":
            raise PuzzleError("對轟題請用對下模式")
        player_id, player = self.player(nickname)
        board = self._line_board(puzzle, moves)
        try:
            move = parse_move(board, answer)
        except IllegalMoveError as error:
            raise PuzzleError(str(error)) from error
        played = move_model(board, move)
        expected = puzzle.solution[len(moves)]
        last = len(moves) + 1 == len(puzzle.solution)
        after = board.copy()
        after.push(move)
        correct = move.uci() == expected or (last and after.is_checkmate())
        if not correct or last:
            score = 1.0 if correct and not hint_used else 0.0
            return MoveResult(
                correct=correct, played=played, done=True,
                solution=self._models(puzzle.fen, puzzle.solution), rating=self._rate(player_id, player, puzzle, score),
            )  # fmt: skip
        reply = chess.Move.from_uci(puzzle.solution[len(moves) + 1])
        return MoveResult(correct=True, played=played, reply=move_model(after, reply), done=False)

    def give_up(self, puzzle_id: int, nickname: str) -> MoveResult:
        puzzle = self._puzzle(puzzle_id)
        player_id, player = self.player(nickname)
        return MoveResult(
            correct=False, played=None, done=True, solution=self._models(puzzle.fen, puzzle.solution),
            rating=self._rate(player_id, player, puzzle, 0.0),
        )  # fmt: skip

    def hint(self, puzzle_id: int, moves: list[str]) -> Hint:
        puzzle = self._puzzle(puzzle_id)
        if puzzle.type == "battle":
            raise PuzzleError("對轟題沒有提示")
        board = self._line_board(puzzle, moves)
        move = move_model(board, chess.Move.from_uci(puzzle.solution[len(moves)]))
        return Hint(square=move.from_square, drop=move.drop)

    async def battle_move(self, puzzle_id: int, nickname: str, moves: list[str], answer: str) -> BattleMoveResult:
        """One solver move of a battle: scored against the engine's best from the same position, then
        answered by the engine; after `battle_plies` solver moves the result counts for the ratings."""
        puzzle = self._puzzle(puzzle_id)
        if puzzle.type != "battle" or not puzzle.battle_plies:
            raise PuzzleError("這一題不是對轟題")
        player_id, player = self.player(nickname)
        if len(moves) % 2 or len(moves) // 2 >= puzzle.battle_plies:
            raise PuzzleError("對下進度與題目不符，請重新開始這一題")
        try:
            board = build_board(puzzle.fen, moves)
            move = parse_move(board, answer)
        except (LineError, IllegalMoveError) as error:
            raise PuzzleError(str(error)) from error
        fen = board.fen()
        solver = puzzle.solver
        best_lines, played_lines = await asyncio.gather(
            self.miner.lines(fen, 1), self.miner.lines(fen, 1, root_moves=(move.uci(),))
        )
        chances_best = chances(best_lines[0], solver) if best_lines else 0.0
        chances_played = chances(played_lines[0], solver) if played_lines else chances_best
        drop = chances_best - chances_played
        best_move = move_model(board, chess.Move.from_uci(best_lines[0].pv[0].uci)) if best_lines else None
        verdict = "best" if best_move and best_move.uci == move.uci() else next(
            (name for limit, name in VERDICTS if drop >= limit), "good"
        )
        played = move_model(board, move)
        board.push(move)
        moves_left = puzzle.battle_plies - len(moves) // 2 - 1
        reply = None
        if not board.is_game_over():
            reply_lines = await self.miner.lines(board.fen(), 1)
            if reply_lines:
                reply_move = chess.Move.from_uci(reply_lines[0].pv[0].uci)
                reply = move_model(board, reply_move)
                board.push(reply_move)
        done = board.is_game_over() or moves_left == 0
        result = final = rating = None
        if done:
            if board.is_checkmate():
                final = 1.0 if color_name(board.turn) != solver else -1.0
            else:
                final_lines = await self.miner.lines(board.fen(), 1)
                final = chances(final_lines[0], solver) if final_lines else chances_played
            start = puzzle.start_chances or 0.0
            result = 1.0 if final >= start + BATTLE_MARGIN else 0.0 if final <= start - BATTLE_MARGIN else 0.5
            rating = self._rate(player_id, player, puzzle, result)
        return BattleMoveResult(
            played=played, verdict=verdict, best=best_move, chances_best=chances_best,
            chances_played=chances_played, reply=reply, done=done, moves_left=max(0, moves_left),
            final_chances=final, result=result, rating=rating,
        )  # fmt: skip

    def export(self, puzzle_id: int, with_solution: bool) -> PuzzleExport:
        puzzle = self._puzzle(puzzle_id)
        nodes = [ExportNode(moves=[])]
        if with_solution:
            nodes += [ExportNode(moves=puzzle.solution[: i + 1]) for i in range(len(puzzle.solution))]
        headers = {"Event": f"Crazyhouse Review puzzle #{puzzle.id}（{TYPE_NAMES[puzzle.type]}）"}
        fen = lichess_fen(puzzle.fen)
        return PuzzleExport(
            fen=puzzle.fen,
            lichess_fen=fen,
            pgn=export_pgn(puzzle.fen, headers, nodes),
            lichess_analysis_url="https://lichess.org/analysis/crazyhouse/" + fen.replace(" ", "_"),
            solution_shown=with_solution,
        )

    # --- making puzzles --------------------------------------------------------------------------

    async def create(self, root_fen: str | None, moves: list[str], kind: PuzzleType) -> Puzzle:
        """A puzzle of `kind` from this position, if the engine confirms it is one."""
        try:
            fen = build_board(normalize_root_fen(root_fen), moves).fen()
        except LineError as error:
            raise PuzzleError(str(error)) from error
        # The viewer chose the kind: a set-up position counts as a middlegame when they say so.
        candidates = await self.miner.classify(fen, ply=MIDDLEGAME_PLY)
        match = next((p for p in candidates if p.type == kind), None)
        if match is None and kind == "tactics":
            match = next((p for p in candidates if p.type in ("attack", "defense") and len(p.solution) >= 3), None)
            if match:
                match.type = "tactics"
        if match is None:
            found = "、".join(TYPE_NAMES[p.type] for p in candidates) or "沒有任何題型"
            raise PuzzleError(f"engine 判定這個局面不適合當{TYPE_NAMES[kind]}（{found}）：{reason(kind)}")
        match.source = {"kind": "manual"}
        stored = self.store.add(match)
        if stored is None:
            raise PuzzleError(f"這個局面已經是一題{TYPE_NAMES[kind]}")
        return stored

    def _job(self, kind: str, total: int) -> PuzzleJob:
        job = PuzzleJob(job_id=uuid.uuid4().hex[:12], kind=kind, status="running", done=0, total=total)
        self._jobs[job.job_id] = job
        while len(self._jobs) > MAX_JOBS:
            old, _ = self._jobs.popitem(last=False)
            if (task := self._tasks.pop(old, None)) is not None:
                task.cancel()
        return job

    def _run(self, job: PuzzleJob, work) -> None:
        async def run() -> None:
            try:
                puzzles = await work
                stored = [p for p in puzzles if self.store.add(p) is not None]
                job.found = len(stored)
                job.status = "done"
                job.message = f"新增 {len(stored)} 題" + (f"（另有 {len(puzzles) - len(stored)} 題已在題庫中）" if len(puzzles) > len(stored) else "")
            except Exception as error:  # noqa: BLE001 - reported to the client, logged with traceback
                log.exception("puzzle job %s failed", job.job_id)
                job.status, job.message = "error", repr(error)

        self._tasks[job.job_id] = asyncio.create_task(run())

    def mine(self, root_fen: str | None, moves: list[str], label: str) -> PuzzleJob:
        try:
            root = normalize_root_fen(root_fen)
            build_board(root, moves)
        except LineError as error:
            raise PuzzleError(str(error)) from error
        job = self._job("mine", len(moves) + 1)

        def progress(done: int, total: int) -> None:
            job.done, job.total = done, total

        self._run(job, self.miner.mine_line(root, moves, {"kind": "game", "label": label}, progress))
        return job

    def generate(self, count: int, types: list[PuzzleType]) -> PuzzleJob:
        """Start making puzzles; while one batch is running (minutes of engine time on a machine the
        whole network shares) another request gets that batch instead of a second one."""
        running = next((j for j in self._jobs.values() if j.kind == "generate" and j.status == "running"), None)
        if running is not None:
            return running
        job = self._job("generate", count)

        def progress(games: int, total_games: int, found: int) -> None:
            job.done, job.total, job.found = games, total_games, found

        self._run(job, generate(self.miner, self.openings, count, types, random.Random(), progress))
        return job

    def job(self, job_id: str) -> PuzzleJob:
        job = self._jobs.get(job_id)
        if job is None:
            raise PuzzleError("找不到這個工作")
        return job


def reason(kind: PuzzleType) -> str:
    return {
        "attack": "需要有唯一的致勝著（將殺或決定性優勢）",
        "defense": "需要對手有致命威脅、而且只有一步能守住",
        "tactics": "需要中局裡連續三步以上的唯一好著",
        "battle": "需要中局、局勢接近而且雙方王都受到攻擊、都能打入將軍",
    }[kind]
