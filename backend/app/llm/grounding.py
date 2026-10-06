"""Post-check of an LLM answer: which moves it mentions are not backed by the rules or the context.

The LLM may only discuss moves that are legal now or that appear in the data it was given (engine
lines, candidate checks, game moves, threat lines). Anything else is flagged as unverified so the UI
can warn instead of presenting it as fact (task.md §19). Bare squares ("e4") are not judged: they
are usually squares, not moves.
"""

from __future__ import annotations

import json

from chess.variant import CrazyhouseBoard

from ..chess_core import move_model
from .candidates import BARE_SQUARE, MOVE_TOKEN


def normalize(token: str) -> str:
    move = token.rstrip("+#").replace("=", "").replace("0-0-0", "O-O-O").replace("0-0", "O-O")
    return "P" + move if move.startswith("@") else move


def grounded_moves(context: dict, board: CrazyhouseBoard) -> set[str]:
    grounded = {normalize(t) for t in MOVE_TOKEN.findall(json.dumps(context, ensure_ascii=False))}
    for move in board.legal_moves:
        grounded.add(normalize(move_model(board, move).san))
        grounded.add(move.uci())
    return grounded


def unverified_moves(answer: str, context: dict, board: CrazyhouseBoard) -> list[str]:
    grounded = grounded_moves(context, board)
    flagged: list[str] = []
    for token in MOVE_TOKEN.findall(answer):
        if BARE_SQUARE.fullmatch(token):
            continue
        if normalize(token) not in grounded and token not in flagged:
            flagged.append(token)
    return flagged
