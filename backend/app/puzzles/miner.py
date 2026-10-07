"""Find puzzles in positions with the engine: attack, defense, middlegame tactics lines and battles.

Every verdict comes from Fairy-Stockfish searches (winning chances in the solver's point of view, the
same scale as the whole-game review) and the rules (`analyzer`). A puzzle move must be the only good
move: the second best line has to be clearly worse, so a correct answer is never ambiguous.
"""

from __future__ import annotations

import chess
from chess.variant import CrazyhouseBoard

from ..analyzer import move_facts, null_move_view, position_facts
from ..chess_core import build_board, color_name, position_id
from ..engine import EngineService
from ..models import Color, EngineLine
from ..review import winning_chances
from .models import Puzzle

MOVETIME_MS = 500
UNIQUE_GAP = 0.35  # best vs second best (winning chances) for a move to count as the only good one
WINNING = 0.6  # attack: the solver's chances after the best move
HOLDS = -0.3  # defense: the best move keeps the solver at least this well off
THREAT = 0.5  # defense: the opponent's chances if the solver passed
MAX_MATE = 7
MAX_SOLVER_MOVES = 6
MIDDLEGAME_PLY = 16
BATTLE_BALANCE = 0.35  # battle: |solver's chances| at the start
BATTLE_PLIES = 6
FIRST_PLY = 4  # the first moves of a game are not puzzle material


def chances(line: EngineLine, solver: Color) -> float:
    return winning_chances(line.evaluation, line.mate, solver)


def solver_mates(line: EngineLine, solver: Color) -> bool:
    return line.mate is not None and (line.mate > 0) == (solver == "white")


def unique(lines: list[EngineLine], solver: Color) -> bool:
    """Is the best move the only good one? (a single legal move is no choice at all)"""
    if len(lines) < 2:
        return False
    best, second = lines[0], lines[1]
    if solver_mates(best, solver):
        # Any mate in one is accepted as the answer; a longer mate must be the only one.
        return abs(best.mate or 0) == 1 or not solver_mates(second, solver)
    return chances(best, solver) - chances(second, solver) >= UNIQUE_GAP


class Miner:
    def __init__(self, engine: EngineService, movetime_ms: int = MOVETIME_MS) -> None:
        self.engine = engine
        self.movetime_ms = movetime_ms

    async def lines(self, fen: str, multipv: int, root_moves: tuple[str, ...] = (), depth: int | None = None,
                    movetime_ms: int | None = None) -> list[EngineLine]:
        analysis = await self.engine.analyse(
            fen, [], position_id(fen, []), multipv, movetime_ms or self.movetime_ms, root_moves,
            protected=True, depth=depth,
        )  # fmt: skip
        return analysis.lines if analysis.status == "ok" else []

    async def threat(self, board: CrazyhouseBoard) -> float | None:
        """The opponent's winning chances (their point of view) if the side to move passed."""
        view = null_move_view(board)
        if view is None:
            return None
        lines = await self.lines(view.fen(), 1)
        return chances(lines[0], color_name(view.turn)) if lines else None

    async def solution(self, fen: str, solver: Color, first: list[EngineLine]) -> list[str]:
        """Solver moves (each the only good one) and the engine's replies, ending on a solver move: until
        mate, or until the next solver move is no longer unique (the win is then clear)."""
        board = build_board(fen, [])
        limit = MAX_MATE if solver_mates(first[0], solver) else MAX_SOLVER_MOVES
        moves: list[str] = []
        lines = first
        for step in range(limit):
            if step > 0 and not unique(lines, solver):
                break
            move = lines[0].pv[0].uci
            board.push_uci(move)
            moves.append(move)
            if board.is_game_over():
                return moves
            reply = await self.lines(board.fen(), 1)
            if not reply:
                break
            board.push_uci(reply[0].pv[0].uci)
            moves.append(reply[0].pv[0].uci)
            if board.is_game_over():
                break
            lines = await self.lines(board.fen(), 2)
            if not lines:
                break
        if len(moves) % 2 == 0:
            moves = moves[:-1]
        return moves

    async def hardness(self, fen: str, board: CrazyhouseBoard, lines: list[EngineLine]) -> tuple[float, list[str]]:
        """How likely a human misses the best move (0–1), and themes of that move.

        A short search that prefers another move means the answer needs calculation; a quiet move when
        checks or captures are on offer, a sacrifice, or a natural-looking second choice that fails all
        make it harder to see."""
        best = chess.Move.from_uci(lines[0].pv[0].uci)
        facts = move_facts(board, best)
        themes = [tag for tag in facts.tags if tag not in ("check", "capture")]
        score = 0.0
        for depth, weight in ((2, 0.35), (6, 0.2)):
            shallow = await self.lines(fen, 1, depth=depth, movetime_ms=200)
            if shallow and shallow[0].pv[0].uci != best.uci():
                score += weight
        forcing = any(board.is_capture(m) or board.gives_check(m) for m in board.legal_moves)
        if not facts.is_check and not facts.is_capture and forcing:
            score += 0.15
            themes.append("quiet_move")
        if facts.en_prise_to:
            score += 0.2
            themes.append("sacrifice")
        if len(lines) > 1:
            second = chess.Move.from_uci(lines[1].pv[0].uci)
            if board.is_capture(second) or board.gives_check(second):
                score += 0.1
                themes.append("tempting_alternative")
        return min(1.0, score), list(dict.fromkeys(themes))

    async def classify(self, fen: str, ply: int, before: float | None = None) -> list[Puzzle]:
        """Puzzles in this position (the side to move solves). `before`: the solver's chances one move
        earlier, so a position that was already won is not offered as a discovery."""
        board = build_board(fen, [])
        if board.is_game_over() or board.legal_moves.count() < 2:
            return []
        solver = color_name(board.turn)
        lines = await self.lines(fen, 3)
        if len(lines) < 2:
            return []
        best = chances(lines[0], solver)
        found: list[Puzzle] = []
        if unique(lines, solver):
            threat = await self.threat(board)
            kind = None
            if threat is not None and threat >= THREAT and HOLDS <= best < WINNING:
                kind = "defense"
            elif (solver_mates(lines[0], solver) and abs(lines[0].mate or 0) <= MAX_MATE) or best >= WINNING:
                if before is None or before < 0.5:
                    kind = "attack"
            if kind:
                line = await self.solution(fen, solver, lines)
                if line:
                    solver_moves = (len(line) + 1) // 2
                    if ply >= MIDDLEGAME_PLY and solver_moves >= 3 and threat is not None and threat >= 0.2:
                        kind = "tactics"  # a long forced exchange of blows with threats on both sides
                    hardness, themes = await self.hardness(fen, board, lines)
                    if solver_mates(lines[0], solver):
                        themes = [f"mate_in_{abs(lines[0].mate or 0)}", *themes]
                    found.append(Puzzle(
                        type=kind, fen=fen, solver=solver, solution=line, themes=themes, hardness=hardness,
                        rating=1100 + 150 * (solver_moves - 1) + 700 * hardness,
                    ))  # fmt: skip
        if ply >= MIDDLEGAME_PLY and abs(best) <= BATTLE_BALANCE and tense(board):
            hardness, themes = await self.hardness(fen, board, lines)
            found.append(Puzzle(
                type="battle", fen=fen, solver=solver, battle_plies=BATTLE_PLIES, start_chances=best,
                themes=["battle", *themes], hardness=hardness, rating=1400 + 600 * hardness,
            ))  # fmt: skip
        return found

    async def mine_line(self, root_fen: str, moves: list[str], source: dict, progress=None) -> list[Puzzle]:
        """Every puzzle along a line (a game); positions inside a found solution are skipped."""
        found: list[Puzzle] = []
        covered: set[str] = set()
        board = build_board(root_fen, [])
        previous: dict[str, float] = {}  # fen -> chances of its side to move
        for ply in range(len(moves) + 1):
            if ply > 0:
                board.push_uci(moves[ply - 1])
            if progress:
                progress(ply + 1, len(moves) + 1)
            if ply < FIRST_PLY:
                continue
            fen = board.fen()
            if fen in covered:
                continue
            before_fen = build_board(root_fen, moves[: ply - 1]).fen()
            before = -previous[before_fen] if before_fen in previous else None
            puzzles = await self.classify(fen, ply, before)
            lines = await self.lines(fen, 3)  # cached: the solver's chances here, for the next position
            if lines:
                previous[fen] = chances(lines[0], color_name(board.turn))
            for puzzle in puzzles:
                puzzle.source = {**source, "ply": ply}
                found.append(puzzle)
                line_board = board.copy()
                for move in puzzle.solution:
                    line_board.push_uci(move)
                    covered.add(line_board.fen())
        return found


def tense(board: CrazyhouseBoard) -> bool:
    """Both kings under fire and both sides able to drop with check: a position for trading blows."""
    facts = position_facts(board)
    return all(
        side.king_zone_attacks > 0 and side.pocket and any(side.drop_check_squares.values())
        for side in (facts.white, facts.black)
    )
