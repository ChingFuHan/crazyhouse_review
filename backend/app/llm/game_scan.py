"""Whole-game scan: the LLM explains one side's errors and missed chances over the main line.

Only moves the whole-game review flagged are discussed. Each comes with the position before it, the
engine's best line and the engine's continuation after the played move (both searched from the same
position, the review's own searches), and rule facts about both moves — the same kind of data as a
single-position explanation, so the same answer checks apply.
"""

from __future__ import annotations

import chess

from ..analyzer import move_facts
from ..chess_core import build_board, position_id, position_state
from ..engine import EngineService
from ..models import Color, EngineAnalysis, ReviewJob, ReviewPly
from .context import PV_PLIES, line_sans, move_facts_dict, numbered

# Most severe first; at most MAX_MOMENTS of them reach the LLM (in game order).
SEVERITY = ("mate_missed", "mate_allowed", "blunder", "mistake", "inaccuracy")
MAX_MOMENTS = 12
SIDE_NAMES = {"white": "白方", "black": "黑方"}
CLASSIFICATION_NAMES = {
    "mate_missed": "錯過將殺", "mate_allowed": "放任將殺", "blunder": "大錯", "mistake": "錯著", "inaccuracy": "不精確",
}
HEADERS = ("White", "Black", "Result", "Event", "Date")


def scan_question(side: Color) -> str:
    name = SIDE_NAMES[side]
    return (
        f"請根據整局分析，找出{name}在這盤棋中錯過的機會與犯下的錯誤：依時間順序逐一說明每個關鍵時刻{name}實戰走了什麼、"
        "engine 建議什麼、錯過了什麼（例如將殺、打入將軍、吃子或必要的防守），以及對手因此得到的機會；"
        f"最後歸納{name}反覆出現的問題與值得記住的 Crazyhouse pattern。"
    )


def mover(job: ReviewJob, ply: int) -> Color:
    """The side that played the move leading to review entry ``ply`` (moves[ply - 1])."""
    root_turn = build_board(job.root_fen, []).turn
    white = root_turn == chess.WHITE if (ply - 1) % 2 == 0 else root_turn == chess.BLACK
    return "white" if white else "black"


def flagged(job: ReviewJob, side: Color) -> tuple[list[ReviewPly], dict[str, int]]:
    """The side's flagged moves (the most severe MAX_MOMENTS, in game order) and counts per verdict."""
    entries = [p for p in job.plies if p.classification and mover(job, p.ply) == side]
    counts = {kind: sum(p.classification == kind for p in entries) for kind in SEVERITY}
    chosen = sorted(entries, key=lambda p: (SEVERITY.index(p.classification), p.ply))[:MAX_MOMENTS]
    return sorted(chosen, key=lambda p: p.ply), counts


def no_mistakes_answer(side: Color, movetime_ms: int) -> str:
    name = SIDE_NAMES[side]
    kinds = "、".join(CLASSIFICATION_NAMES[k] for k in SEVERITY)
    return f"整局分析沒有發現{name}的錯誤：{name}沒有任何一步被判定為{kinds}（每步以 {movetime_ms} ms 快速搜尋）。"


def _line(analysis: EngineAnalysis, first_ply: int) -> dict | None:
    if not analysis.lines:
        return None
    line = analysis.lines[0]
    return {
        "evaluation": line.evaluation,
        "mate": line.mate,
        "depth": line.depth,
        "pv": numbered([m.san for m in line.pv[:PV_PLIES]], first_ply),
    }


async def build_game_context(
    job: ReviewJob, side: Color, headers: dict[str, str], engine: EngineService, movetime_ms: int, question: str
) -> tuple[dict, int]:
    """The scan context and how many moments it holds. The engine lines come from the review's own
    (cached) searches; a search pushed out of the cache is simply run again."""
    root = build_board(job.root_fen, [])
    chosen, counts = flagged(job, side)
    moments = []
    for entry in chosen:
        before = job.moves[: entry.ply - 1]
        board = build_board(job.root_fen, before)
        pid = position_id(job.root_fen, before)
        played = chess.Move.from_uci(job.moves[entry.ply - 1])
        best = await engine.analyse(job.root_fen, before, pid, 1, movetime_ms, protected=True)
        after = await engine.analyse(job.root_fen, before, pid, 1, movetime_ms, (played.uci(),), protected=True)
        first_ply = root.ply() + entry.ply - 1
        best_line = _line(best, first_ply)
        best_move = chess.Move.from_uci(best.lines[0].pv[0].uci) if best.lines else None
        state = position_state(job.root_fen, before, board)
        moments.append({
            "ply": entry.ply,
            "move": numbered([board.san(played)], first_ply),
            "classification": entry.classification,
            "fen_before": state.fen,
            "pockets_before": {"white": state.pockets.white, "black": state.pockets.black},
            "best": {**(best_line or {}), "facts": move_facts_dict(move_facts(board, best_move))} if best_move else None,
            "played": {**(_line(after, first_ply) or {}), "facts": move_facts_dict(move_facts(board, played))},
        })
    context = {
        "variant": "crazyhouse",
        "task": "game_scan",
        "side": side,
        "evaluation_pov": "white",
        "game": {
            "headers": {k: v for k, v in headers.items() if k in HEADERS},
            "start_fen": job.root_fen,
            "total_plies": len(job.moves),
            "moves": numbered(line_sans(job.root_fen, job.moves), root.ply()),
        },
        "review": {
            "engine": engine.name,
            "movetime_ms": movetime_ms,
            "method": "每個局面以相同時間搜尋最佳著；實戰著與最佳著不同時，從同一局面另外搜尋實戰著（searchmoves）。"
            "以走子方勝率下降 0.1／0.2／0.3 判定不精確／錯著／大錯，並另外判定錯過將殺與放任將殺。",
            "counts": counts,
            "moments_shown": len(moments),
        },
        "moments": moments,
        "user_question": question,
    }
    return context, len(moments)
