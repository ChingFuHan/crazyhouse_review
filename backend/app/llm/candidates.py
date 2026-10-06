"""Candidate moves mentioned in a question (task.md §22).

A move the user names is never judged by the LLM alone: it is parsed, checked for legality,
and, if legal and not already in the engine's MultiPV, analysed by the engine from the
position after it. Illegal moves get the rules' reason and never reach the engine.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import chess
from chess.variant import CrazyhouseBoard

from ..analyzer import move_facts
from ..chess_core import IllegalMoveError, move_model, parse_move, position_id
from ..engine import EngineService, EngineUnavailable
from ..models import CheckedMove, EngineAnalysis
from .context import PV_PLIES, move_facts_dict, numbered

# Legality is checked for every named move (cheap); fresh engine searches are capped per question.
MAX_NAMED_MOVES = 10
MAX_ENGINE_SEARCHES = 3
# SAN / UCI / drop / castling tokens. Neighbouring CJK text is fine; ASCII letters/digits are not.
MOVE_TOKEN = re.compile(
    r"(?<![A-Za-z0-9@])("
    r"O-O-O|O-O|0-0-0|0-0"
    r"|[PNBRQ]?@[a-h][1-8][+#]?"
    r"|[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?"
    r"|[a-h]x[a-h][1-8](?:=?[QRBN])?[+#]?"
    r"|[a-h][1-8][a-h][1-8][qrbn]?"
    r"|[a-h][1-8](?:=?[QRBN])?[+#]?"
    r")(?![A-Za-z0-9])"
)
BARE_SQUARE = re.compile(r"[a-h][1-8][+#]?")


@dataclass
class CandidateCheck:
    input: str
    legal: bool
    reason: str | None = None
    uci: str | None = None
    san: str | None = None
    source: str | None = None  # "multipv" | "engine_after_move" | "rules" | "not_analyzed" | "unavailable"
    multipv_rank: int | None = None
    evaluation: float | None = None
    mate: int | None = None
    depth: int | None = None
    pv_after: str | None = None
    facts: dict = field(default_factory=dict)

    def summary(self) -> CheckedMove:
        return CheckedMove(
            input=self.input,
            legal=self.legal,
            reason=self.reason,
            san=self.san,
            uci=self.uci,
            source=self.source,
            multipv_rank=self.multipv_rank,
            evaluation=self.evaluation,
            mate=self.mate,
        )

    def context(self) -> dict:
        if not self.legal:
            return {"input": self.input, "legal": False, "illegal_reason": self.reason}
        if self.source == "not_analyzed":
            return {
                "input": self.input,
                "legal": True,
                "san": self.san,
                "uci": self.uci,
                "source": "not_analyzed",
                "note": "only checked for legality; no engine analysis",
            }
        return {
            "input": self.input,
            "legal": True,
            "san": self.san,
            "uci": self.uci,
            "source": self.source,
            "multipv_rank": self.multipv_rank,
            "evaluation": self.evaluation,
            "mate": self.mate,
            "evaluation_pov": "white",
            "depth": self.depth,
            "line_after_move": self.pv_after,
            "facts": self.facts,
        }


def extract_candidates(board: CrazyhouseBoard, question: str) -> list[CandidateCheck]:
    """Moves named in the question. A bare square ("e4") counts only if it is a legal pawn move,
    since users also write squares that are not meant as moves."""
    checks: list[CandidateCheck] = []
    seen: set[str] = set()
    for token in MOVE_TOKEN.findall(question):
        if token in seen or len(checks) >= MAX_NAMED_MOVES:
            continue
        seen.add(token)
        try:
            move = parse_move(board, token)
        except IllegalMoveError as error:
            if not BARE_SQUARE.fullmatch(token):
                checks.append(CandidateCheck(input=token, legal=False, reason=error.reason))
            continue
        model = move_model(board, move)
        if any(c.uci == model.uci for c in checks):
            continue
        checks.append(CandidateCheck(input=token, legal=True, uci=model.uci, san=model.san))
    return checks


async def analyse_candidates(
    checks: list[CandidateCheck],
    board: CrazyhouseBoard,
    root_fen: str,
    moves: list[str],
    analysis: EngineAnalysis,
    engine: EngineService,
) -> None:
    """Fill in engine evidence for each legal candidate (same search settings as the position).
    Moves beyond MAX_ENGINE_SEARCHES fresh searches are marked "not_analyzed", never guessed."""
    ranks = {line.pv[0].uci: line for line in analysis.lines}
    searches = 0
    for check in checks:
        if not check.legal:
            continue
        move = chess.Move.from_uci(check.uci)
        check.facts = move_facts_dict(move_facts(board, move))
        if check.uci in ranks:
            line = ranks[check.uci]
            check.source, check.multipv_rank = "multipv", line.rank
            check.evaluation, check.mate, check.depth = line.evaluation, line.mate, line.depth
            check.pv_after = numbered([m.san for m in line.pv[1 : PV_PLIES + 1]], board.ply() + 1)
            continue
        after = board.copy(stack=False)
        after.push(move)
        if after.is_game_over():
            # Decided by the rules: the move mates (mate in 1, White POV sign) or draws.
            check.source = "rules"
            if after.is_checkmate():
                check.mate = 1 if board.turn == chess.WHITE else -1
            else:
                check.evaluation = 0.0
            continue
        if searches >= MAX_ENGINE_SEARCHES:
            check.source = "not_analyzed"
            continue
        searches += 1
        line_moves = [*moves, check.uci]
        try:
            result = await engine.analyse(
                root_fen,
                line_moves,
                position_id(root_fen, line_moves),
                analysis.multipv,
                analysis.movetime_ms,
                protected=True,
            )
        except EngineUnavailable:
            result = None
        if result is None or result.status != "ok" or not result.lines:
            check.source = "unavailable"
            continue
        best_reply = result.lines[0]
        check.source = "engine_after_move"
        check.evaluation, check.mate, check.depth = best_reply.evaluation, best_reply.mate, best_reply.depth
        check.pv_after = numbered([m.san for m in best_reply.pv[:PV_PLIES]], board.ply() + 1)


def illegal_only_answer(checks: list[CandidateCheck]) -> str:
    lines = ["你提到的棋步在目前局面不合法，因此沒有送去 Engine 分析："]
    lines += [f"- {c.input}：{c.reason}" for c in checks]
    return "\n".join(lines)
