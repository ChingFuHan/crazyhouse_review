"""Post-check of an LLM answer: which of its statements the rules and the context data do not back.

The LLM may only discuss moves that appear in the data it was given (engine lines, candidate checks,
game moves, threat lines), quote evaluations and mate distances the engine reported, and say a side is
better only when some engine evaluation says so. Anything else is reported as a warning so the UI can
flag it instead of presenting it as fact (task.md §19). The checks are deliberately conservative
pattern matches: bare squares ("e4") are not judged, evaluations are compared by absolute value (the
answer may use the side to move's point of view), and negated statements ("沒有一步殺") are skipped.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator

from chess.variant import CrazyhouseBoard

from ..analyzer import null_move_view
from ..chess_core import move_model
from ..models import AnswerWarning
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


def _legal(board: CrazyhouseBoard) -> set[str]:
    return {normalize(move_model(board, m).san) for m in board.legal_moves} | {m.uci() for m in board.legal_moves}


def _drop_checks(evidence: dict) -> set[str]:
    """Drop checks the rules found ("N@h6"): the analysis lists them as squares per pocket piece."""
    drops = ((evidence.get("analysis") or {}).get("important_drop_squares")) or {}
    return {f"{piece}@{square}" for side in ("white", "black") for piece, squares in (drops.get(side) or {}).items()
            for square in squares}


def _continuations(board: CrazyhouseBoard, evidence: dict) -> set[str]:
    """Moves legal one step further: the opponent's if the side to move passed, or replies to one of the
    engine's (or the checked candidates') first moves. Mentioning them is the LLM's own line of play."""
    boards = [view] if (view := null_move_view(board)) is not None else []
    firsts = [line.get("pv", "") for line in (evidence.get("engine") or {}).get("multipv", [])]
    firsts += [entry.get("san", "") for entry in evidence.get("candidate_analysis", []) if entry.get("legal")]
    for text in firsts:
        tokens = MOVE_TOKEN.findall(text)
        try:
            move = board.parse_san(tokens[0]) if tokens else None
        except ValueError:
            move = None
        if move is not None:
            after = board.copy(stack=False)
            after.push(move)
            boards.append(after)
    return set().union(*(_legal(b) for b in boards))


def _move_warnings(answer: str, evidence: dict, not_analyzed: set[str], board: CrazyhouseBoard) -> list[AnswerWarning]:
    """Moves the answer mentions that appear nowhere in the evidence: legal now but never analysed by the
    engine (named by the user and only checked for legality, or proposed by the LLM), the LLM's own
    continuation of a line, or not legal at all."""
    in_context = {normalize(t) for t in MOVE_TOKEN.findall(json.dumps(evidence, ensure_ascii=False))}
    in_context |= _drop_checks(evidence)
    legal = _legal(board)
    continuations: set[str] | None = None  # computed only when needed
    warnings: list[AnswerWarning] = []
    seen: set[str] = set()
    for token in MOVE_TOKEN.findall(answer):
        if BARE_SQUARE.fullmatch(token) or token in seen:
            continue
        seen.add(token)
        move = normalize(token)
        if move in in_context:
            continue
        if move in legal or move in not_analyzed:
            warnings.append(AnswerWarning(
                kind="unanalysed_move",
                quote=token,
                detail=f"{token} 是合法著，但沒有經過 engine 分析；回答中對這步的評價是 AI 的推測。",
            ))
            continue
        if continuations is None:
            continuations = _continuations(board, evidence)
        if move in continuations:
            warnings.append(AnswerWarning(
                kind="unanalysed_move",
                quote=token,
                detail=f"{token} 是 AI 自行推演的後續著法，engine 沒有分析這條變化。",
            ))
        else:
            warnings.append(AnswerWarning(
                kind="illegal_move",
                quote=token,
                detail=f"{token} 在目前局面不是合法著，也不在 engine 分析的變化或對局紀錄中，可能是 AI 推測或錯誤的著法。",
            ))
    return warnings


# --- evaluations, mate distances, advantage ---------------------------------------------------------

NEGATIONS = ("沒有", "沒", "無", "不是", "並非", "不會", "未", "不存在")
CLAUSE_END = re.compile(r"[，。；！？,.;!?\n]")
CN_DIGITS = {"一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}

# A signed number directly followed by digits: "+2.3", "-1.5", "−0.8" (not "1-0", not "e4-e5").
EVAL_CLAIM = re.compile(r"(?<![A-Za-z0-9.+\-−])([+\-−])(\d{1,2}(?:\.\d{1,2})?)(?![\d.])")
MATE_CLAIM = re.compile(
    r"(?P<cn>\d+|[一二兩三四五六七八九十]+)\s*步(?:之內|以內|內)?\s*(?:殺|將死|將殺|絕殺)"
    r"|(?i:mate\s+(?:in\s+)?)-?(?P<en>\d+)"
    r"|(?<![A-Za-z0-9])[#M]-?(?P<sym>\d+)(?![\d.])"
)
ADVANTAGE_CLAIM = re.compile(
    r"(?P<side>[白黑])方?的?(?:目前|現在|仍然|仍|已經|已|明顯|稍微|稍|略|大幅|取得了?|佔有|占有|具有|有)?"
    r"(?:優勢|佔優|占優|勝勢|大優|有利)"
    r"|對(?P<side2>[白黑])方?(?:較為|較|更|明顯|非常|十分)?有利"
)
# Evaluations (pawns, White POV) at least this far from 0 back a "this side is better" statement.
ADVANTAGE_MIN = 0.3


def _negated(text: str, start: int) -> bool:
    """A negation earlier in the same clause: 「不存在任何空投將軍或一步殺威脅」."""
    clause = max((m.end() for m in CLAUSE_END.finditer(text, 0, start)), default=0)
    return any(word in text[clause:start] for word in NEGATIONS)


def _number(token: str) -> int | None:
    if token.isdigit():
        return int(token)
    if token == "十":
        return 10
    if token.startswith("十") and len(token) == 2:
        return 10 + CN_DIGITS.get(token[1], 0)
    return CN_DIGITS.get(token) if len(token) == 1 else None


def _walk(value, key: str = "") -> Iterator[tuple[str, object]]:
    if isinstance(value, dict):
        for k, v in value.items():
            yield from _walk(v, k)
    elif isinstance(value, list):
        for v in value:
            yield from _walk(v, key)
    else:
        yield key, value


def _engine_numbers(evidence: dict) -> tuple[list[float], list[int], bool]:
    """Every evaluation and mate value (White POV) in the evidence, and whether any mate in one is
    known from the rules (mate-in-one lists, a candidate that mates or threatens mate)."""
    evaluations: list[float] = []
    mates: list[int] = []
    mate_in_one = False
    for key, value in _walk(evidence):
        if isinstance(value, bool):
            if value and key == "is_mate":
                mate_in_one = True
        elif key == "evaluation" and isinstance(value, (int, float)):
            evaluations.append(float(value))
        elif key == "mate" and isinstance(value, int) and value != 0:
            mates.append(value)
        elif key in ("mate_in_one_for_side_to_move", "opponent_mate_in_one_if_ignored", "threatens_mate_in_one_next") and value:
            mate_in_one = True
    return evaluations, mates, mate_in_one


def _engine_summary(context: dict) -> str:
    engine = context.get("engine") or {}
    if engine.get("mate"):
        return f"engine 最佳著為 #{engine['mate']}（白方視角）"
    if engine.get("evaluation") is not None:
        return f"engine 最佳著評估為 {engine['evaluation']:+.1f}（白方視角）"
    return "engine 沒有提供評估"


def _claim_warnings(answer: str, context: dict, evidence: dict) -> list[AnswerWarning]:
    evaluations, mates, mate_in_one = _engine_numbers(evidence)
    summary = _engine_summary(context)
    warnings: list[AnswerWarning] = []

    for match in EVAL_CLAIM.finditer(answer):
        quote = match.group(0)
        if answer[max(0, match.start() - 6) : match.start()].rstrip().lower().endswith(("mate", "#", "m", "將死", "殺")):
            continue  # "mate -1" is a mate distance, checked below
        value = abs(float(match.group(2)))
        tolerance = 0.15 if "." in match.group(2) else 0.5
        if any(abs(value - abs(e)) <= tolerance for e in evaluations):
            continue
        warnings.append(AnswerWarning(
            kind="evaluation", quote=quote, detail=f"回答中的評估 {quote} 與 engine 結果不符（{summary}）。"
        ))

    longest = max([abs(m) for m in mates] + ([1] if mate_in_one else []), default=0)
    for match in MATE_CLAIM.finditer(answer):
        n = _number(match.group("cn") or match.group("en") or match.group("sym") or "")
        if not n or _negated(answer, match.start()):
            continue
        if n <= longest:  # a shorter mate is what remains of a longer one further down the line
            continue
        found = f"最長只有 {longest} 步殺" if longest else "沒有任何將殺"
        warnings.append(AnswerWarning(
            kind="mate", quote=match.group(0), detail=f"回答提到「{match.group(0)}」，但 engine 結果中{found}。"
        ))

    if evaluations or mates:
        white = any(e >= ADVANTAGE_MIN for e in evaluations) or any(m > 0 for m in mates)
        black = any(e <= -ADVANTAGE_MIN for e in evaluations) or any(m < 0 for m in mates)
        for match in ADVANTAGE_CLAIM.finditer(answer):
            side = match.group("side") or match.group("side2")
            if _negated(answer, match.start()) or (white if side == "白" else black):
                continue
            warnings.append(AnswerWarning(
                kind="advantage",
                quote=match.group(0),
                detail=f"回答說「{match.group(0)}」，但 engine 分析的變化中沒有任何一條對{side}方有利（{summary}）。",
            ))

    unique: dict[tuple[str, str], AnswerWarning] = {}
    for warning in warnings:
        unique.setdefault((warning.kind, warning.quote), warning)
    return list(unique.values())


def check_answer(answer: str, context: dict, board: CrazyhouseBoard) -> list[AnswerWarning]:
    """All warnings for an answer about the position `board`, given the context the LLM received."""
    evidence, not_analyzed = _evidence(context)
    return _move_warnings(answer, evidence, not_analyzed, board) + _claim_warnings(answer, context, evidence)
