"""Make new puzzle positions on purpose: imperfect engine self-play from real openings.

Each game starts from the opening of a real game and is played by Fairy-Stockfish at a short search,
choosing now and then a second or third choice that is not much worse — the slips a human makes. The
games are mined like real ones and the puzzles a human would most likely miss (highest hardness) are
kept first.
"""

from __future__ import annotations

import random

from ..chess_core import STARTING_FEN, build_board, color_name, position_id
from ..engine import EngineService
from .miner import Miner, chances
from .models import Puzzle, PuzzleType

PLAY_MS = 120
MAX_PLIES = 90
OPENING_PLIES = (6, 14)
# Probability of playing the best / second / third engine choice, when the latter are close enough.
CHOICE_WEIGHTS = (0.7, 0.2, 0.1)
SLIP = 0.25  # largest drop in winning chances a "human" slip may cost
MAX_GAMES_PER_PUZZLE = 4


async def selfplay(engine: EngineService, root_fen: str, opening: list[str], rng: random.Random) -> list[str]:
    """A game continuing `opening`, played with occasional human-like slips."""
    moves = list(opening)
    board = build_board(root_fen, moves)
    while len(moves) < MAX_PLIES and not board.is_game_over():
        analysis = await engine.analyse(
            root_fen, moves, position_id(root_fen, moves), 3, PLAY_MS, protected=True
        )
        if analysis.status != "ok" or not analysis.lines:
            break
        mover = color_name(board.turn)
        best = chances(analysis.lines[0], mover)
        options = [line for line in analysis.lines if best - chances(line, mover) <= SLIP]
        weights = CHOICE_WEIGHTS[: len(options)]
        move = rng.choices(options, weights=weights)[0].pv[0].uci
        board.push_uci(move)
        moves.append(move)
    return moves


async def generate(miner: Miner, openings: list[tuple[str, list[str]]], count: int, types: list[PuzzleType],
                   rng: random.Random, progress=None) -> list[Puzzle]:
    """Up to `count` new puzzles of `types`, the hardest first, from self-play games."""
    found: list[Puzzle] = []
    games = max(1, count * MAX_GAMES_PER_PUZZLE // 2)
    for game in range(games):
        root_fen, line = rng.choice(openings) if openings else (STARTING_FEN, [])
        opening = line[: rng.randint(*OPENING_PLIES)]
        moves = await selfplay(miner.engine, root_fen, opening, rng)
        source = {"kind": "selfplay", "opening_plies": len(opening)}
        found += [p for p in await miner.mine_line(root_fen, moves, source) if p.type in types]
        if progress:
            progress(game + 1, games, len(found))
        if len(found) >= count * 2:  # enough to choose the hardest from
            break
    found.sort(key=lambda p: p.hardness, reverse=True)
    return found[:count]
