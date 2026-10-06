"""Build the LLM context for the active position (task.md §18).

Everything in it is produced server-side from the canonical line, the engine result and the
analyzer, except PGN comments/headers which are passed through as quoted untrusted data.
"""

from __future__ import annotations

import json

import chess
from chess.variant import CrazyhouseBoard

from ..chess_core import IllegalMoveError, build_board, move_model, parse_move
from ..models import CandidateFacts, EngineAnalysis, ExplainRequest, Insights, MoveFacts, PositionState, SideFacts

CONTEXT_VERSION = "ctx-v3"
RECENT_PLIES = 12
PV_PLIES = 10


def numbered(sans: list[str], first_ply: int) -> str:
    """'18.Qh5 B@e2 19.Qxe2' from SAN list starting after `first_ply` plies (0 = White's first move)."""
    out = []
    for offset, san in enumerate(sans):
        ply = first_ply + offset
        if ply % 2 == 0:
            out.append(f"{ply // 2 + 1}.{san}")
        elif offset == 0:
            out.append(f"{ply // 2 + 1}...{san}")
        else:
            out.append(san)
    return " ".join(out)


def _sans(root_fen: str, moves: list[str]) -> list[str]:
    board = CrazyhouseBoard(root_fen)
    out = []
    for uci in moves:
        move = chess.Move.from_uci(uci)
        out.append(move_model(board, move).san)
        board.push(move)
    return out


def move_facts_dict(f: MoveFacts) -> dict:
    return {
        "san": f.move.san,
        "uci": f.move.uci,
        "mover": f.mover,
        "is_check": f.is_check,
        "is_mate": f.is_mate,
        "captured": f.captured,
        "is_drop": f.is_drop,
        "promotion": f.move.promotion,
        "discovered_check": f.discovered_check,
        "attacks_after_move": [f"{p.piece}{p.square}" for p in f.attacks],
        "opponent_king_escape_squares": {"before": f.opponent_king_escape_before, "after": f.opponent_king_escape_after},
        "pocket": {"before": f.pocket_before, "after": f.pocket_after},
        "opponent_reply_count": f.opponent_reply_count,
        "opponent_forced_replies": f.forced_replies,
        "discovered_attacks": [f"{e.attacker}->{e.target}" for e in f.discovered_attacks],
        "blocked_enemy_lines": [f"{e.attacker}->{e.target}" for e in f.blocked_lines],
        "opened_file": f.opened_file.model_dump() if f.opened_file else None,
        "threatens_mate_in_one_next": f.threatens_mate,
        "moved_piece_can_be_taken_at_profit_by": f.en_prise_to,
        "tags": f.tags,
    }


def _candidate(c: CandidateFacts, ply: int) -> dict:
    return {
        "rank": c.rank,
        "evaluation": c.evaluation,
        "mate": c.mate,
        "evaluation_pov": "white",
        "depth": c.depth,
        "pv": numbered([p.san for p in c.pv[:PV_PLIES]], ply),
        "mover_consecutive_checks_from_start": c.forcing_checks,
        "facts": move_facts_dict(c.facts),
    }


def _game_move(root_fen: str, moves: list[str], start_ply: int, request: ExplainRequest) -> dict | None:
    if request.game_move is None:
        return None
    index = request.game_move_ply if request.game_move_ply is not None else len(moves)
    if index > len(moves):
        return None
    board = build_board(root_fen, moves[:index])
    try:
        move = parse_move(board, request.game_move)
    except IllegalMoveError:
        return None  # untrusted metadata that does not fit the line is dropped, not trusted
    return {"ply": start_ply + index + 1, "san": numbered([move_model(board, move).san], start_ply + index), "uci": move.uci()}


def _side(s: SideFacts) -> dict:
    return {
        "king_square": s.king_square,
        "king_zone_squares_attacked_by_opponent": s.king_zone_attacks,
        "hanging_pieces": [f"{x.piece}{x.square}" for x in s.hanging_pieces],
        "attacked_queens_rooks": [f"{x.piece}{x.square}" for x in s.attacked_queens_rooks],
        "king_zone_attackers": s.king_zone_attackers,
        "attacked_squares": s.attacked_squares,
        "defended_squares": s.defended_squares,
        "board_material": s.board_material,
    }


def build_context(
    request: ExplainRequest, state: PositionState, analysis: EngineAnalysis, insights: Insights, question: str
) -> dict:
    """task.md §18 context. `position` is the full §7 canonical record of the active position:
    the backend PositionState plus the variation it belongs to in the UI tree."""
    root_fen, moves = state.root_fen, state.moves
    sans = _sans(root_fen, moves)
    start_ply = state.ply - len(moves)
    recent_from = max(0, len(sans) - RECENT_PLIES)
    game_move = _game_move(root_fen, moves, start_ply, request)
    variation: dict = {"on_main_line": request.on_main_line}
    if not request.on_main_line and request.game_move_ply is not None and request.game_move_ply <= len(moves):
        variation["branch_ply"] = request.game_move_ply
        variation["user_moves_since_branch"] = numbered(sans[request.game_move_ply :], start_ply + request.game_move_ply)

    p = insights.position
    best = analysis.lines[0] if analysis.lines else None
    return {
        "variant": "crazyhouse",
        "position": {
            "position_id": state.position_id,
            "variation_id": request.variation_id,
            "ply": state.ply,
            "fen": state.fen,
            "side_to_move": state.side_to_move,
            "white_pocket": state.pockets.white,
            "black_pocket": state.pockets.black,
            "move_history": state.moves,
            "last_move": {"uci": state.last_move.uci, "san": state.last_move.san} if state.last_move else None,
            "promoted_pieces_on": state.promoted,
            "is_check": state.is_check,
            "outcome": state.outcome.model_dump() if state.outcome else None,
        },
        "pockets": {"white": state.pockets.white, "black": state.pockets.black},
        "game": {
            "ply": state.ply,
            "move_number": state.move_number,
            "last_move": {"uci": state.last_move.uci, "san": state.last_move.san} if state.last_move else None,
            "recent_moves": numbered(sans[recent_from:], start_ply + recent_from),
            "game_move": game_move,
            "variation": variation,
            "headers": {k: v for k, v in request.headers.items() if k in ("White", "Black", "Result", "Event", "Date")},
            "viewer_side": request.viewer_side,
        },
        "engine": {
            "name": analysis.engine,
            "status": analysis.status,
            "analysis_id": analysis.analysis_id,
            "depth": analysis.depth,
            "evaluation_pov": "white",
            "evaluation": best.evaluation if best else None,
            "mate": best.mate if best else None,
            "best_move": {"uci": best.pv[0].uci, "san": best.pv[0].san} if best else None,
            "multipv": [
                {
                    "rank": line.rank,
                    "evaluation": line.evaluation,
                    "mate": line.mate,
                    "pv": numbered([m.san for m in line.pv[:PV_PLIES]], state.ply),
                }
                for line in analysis.lines
            ],
        },
        "analysis": {
            "checks": {
                "side_to_move_in_check": p.in_check,
                "checkers": [f"{x.piece}{x.square}" for x in p.checkers],
                "mate_in_one_for_side_to_move": p.mate_in_one,
            },
            "mate_threats": {
                "opponent_mate_in_one_if_ignored": p.opponent_mate_threats,
                "moves_after_which_opponent_has_no_mate_in_one": p.defenses_to_mate_threats,
                "threat_if_side_to_move_passes": insights.threat.model_dump() if insights.threat else None,
            },
            "king_escape_squares": {"white": p.white.king_escape_squares, "black": p.black.king_escape_squares},
            "important_drop_squares": {
                "description": "pocket piece -> empty squares where dropping it gives check",
                "white": p.white.drop_check_squares,
                "black": p.black.drop_check_squares,
            },
            "legal_move_count": p.legal_move_count,
            "white": _side(p.white),
            "black": _side(p.black),
            "last_move": move_facts_dict(insights.last_move) if insights.last_move else None,
            "candidates": [_candidate(c, state.ply) for c in insights.candidates],
        },
        "pgn_comments": [{"ply": c.ply, "text": c.text} for c in request.comments],
        "user_question": question,
    }


def render_user_message(context: dict, question: str) -> str:
    """The context block is JSON followed by the user's question. '<' and '>' are escaped inside the
    JSON (valid string escapes), so untrusted text such as PGN comments can never close the block."""
    payload = json.dumps(context, ensure_ascii=False, sort_keys=True, indent=1)
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e")
    return f"<position_context>\n{payload}\n</position_context>\n\n{question}"
