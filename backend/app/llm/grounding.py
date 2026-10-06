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


# Text the user or the PGN supplied is not evidence: a move written there is not backed by anything.
NOT_EVIDENCE = ("user_question", "pgn_comments")


def _evidence(context: dict) -> tuple[dict, set[str]]:
    """The part of the context that backs moves, and the named-but-unanalysed candidates."""
    entries = context.get("candidate_analysis") or []
    skipped = [e for e in entries if e.get("source") == "not_analyzed"]
    names = {normalize(str(e[k])) for e in skipped for k in ("input", "san", "uci") if e.get(k)}
    evidence = {k: v for k, v in context.items() if k not in NOT_EVIDENCE}
    evidence["candidate_analysis"] = [e for e in entries if e.get("source") != "not_analyzed"]
    if isinstance(evidence.get("game"), dict):
        evidence["game"] = {k: v for k, v in evidence["game"].items() if k != "headers"}
    return evidence, names


def unverified_moves(answer: str, context: dict, board: CrazyhouseBoard) -> list[str]:
    """Moves the answer mentions that nothing backs: not in the context data and either illegal now
    or named by the user but never analysed by the engine."""
    evidence, not_analyzed = _evidence(context)
    in_context = {normalize(t) for t in MOVE_TOKEN.findall(json.dumps(evidence, ensure_ascii=False))}
    legal = {normalize(move_model(board, m).san) for m in board.legal_moves} | {m.uci() for m in board.legal_moves}
    flagged: list[str] = []
    for token in MOVE_TOKEN.findall(answer):
        if BARE_SQUARE.fullmatch(token) or token in flagged:
            continue
        move = normalize(token)
        if move in in_context:
            continue
        if move in not_analyzed or move not in legal:
            flagged.append(token)
    return flagged
