"""Deterministic analyzer facts (no engine needed except where noted)."""

import json
from pathlib import Path

import chess
import pytest

from app.analyzer import (
    drop_check_squares,
    hanging_pieces,
    king_escape_squares,
    mating_moves,
    move_facts,
    position_facts,
    pv_facts,
)
from app.chess_core import STARTING_FEN, build_board, move_model
from app.models import EngineLine
from app.pgn_import import import_pgn

KNIGHT_TRADE_E6 = build_board(STARTING_FEN, ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4", "e7e6"])


def board(fen):
    return build_board(fen, [])


def facts(fen, move):
    b = board(fen)
    return move_facts(b, b.parse_san(move))


def test_king_escape_squares():
    assert king_escape_squares(KNIGHT_TRADE_E6, chess.BLACK) == ["e7"]
    assert king_escape_squares(board("6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"), chess.BLACK) == ["f8", "h8"]
    # Castling is not an escape square.
    assert "g1" not in king_escape_squares(board("4k3/8/8/8/8/8/8/4K2R[] w K - 0 1"), chess.WHITE)


def test_drop_check_squares_for_side_to_move_and_opponent():
    assert drop_check_squares(KNIGHT_TRADE_E6, chess.WHITE) == {"N": ["d6", "f6"]}
    # Black's pawn could only check from d2/f2, both occupied.
    assert drop_check_squares(KNIGHT_TRADE_E6, chess.BLACK) == {}
    b = board("4k3/8/8/8/8/8/8/4K3[Pq] w - - 0 1")
    assert drop_check_squares(b, chess.WHITE) == {"P": ["d7", "f7"]}
    queen = set(drop_check_squares(b, chess.BLACK)["Q"])
    assert {"e2", "e7", "a1", "h1", "a5", "h4"} <= queen
    assert "e8" not in queen and "b3" not in queen


def test_hanging_pieces():
    b = board("4k3/8/8/3q4/8/8/8/3RK3[] w - - 0 1")
    assert [(p.square, p.piece) for p in hanging_pieces(b, chess.BLACK)] == [("d5", "Q")]
    assert hanging_pieces(b, chess.WHITE) == []  # Rd1 is defended by the king
    # The only attacker (Be2) is pinned to its king by Re7: the knight is not hanging.
    pinned = board("4k3/4r3/8/8/2n5/8/4B3/4K3[] w - - 0 1")
    assert hanging_pieces(pinned, chess.BLACK) == []
    unpinned = board("4k3/8/8/8/2n5/8/4B3/4K3[] w - - 0 1")
    assert [p.square for p in hanging_pieces(unpinned, chess.BLACK)] == ["c4"]


def test_mate_in_one_and_opponent_threats():
    assert sorted(mating_moves(board("6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1"))) == [
        "R@a8#", "R@b8#", "R@c8#", "R@d8#", "R@e8#",
    ]
    threatened = position_facts(board("6k1/5ppp/8/8/8/8/5PPP/6K1[r] w - - 0 1"))
    assert threatened.mate_in_one == []
    assert sorted(threatened.opponent_mate_threats) == ["R@a1#", "R@b1#", "R@c1#", "R@d1#", "R@e1#"]


def test_position_facts_in_check():
    b = build_board(STARTING_FEN, ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4", "e7e6", "N@d6"])
    pf = position_facts(b)
    assert pf.in_check and [(c.square, c.piece) for c in pf.checkers] == [("d6", "N")]
    assert pf.opponent_mate_threats == []  # not computed while in check
    assert pf.legal_move_count == 3


def test_drop_check_move_facts():
    f = move_facts(KNIGHT_TRADE_E6, chess.Move.from_uci("N@d6"))
    assert (f.is_check, f.is_drop, f.is_mate) == (True, True, False)
    assert f.pocket_before == ["N"] and f.pocket_after == []
    assert f.forced_replies == ["Ke7", "Bxd6", "cxd6"]
    assert "drop_check" in f.tags and "drop" in f.tags


def test_drop_mate_and_escape_reduction():
    f = facts("6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1", "R@e8")
    assert f.is_mate and "drop_mate" in f.tags
    assert f.opponent_king_escape_before == ["f8", "h8"] and f.opponent_king_escape_after == []
    assert "escape_square_reduction" in f.tags
    assert f.opponent_reply_count == 0


def test_knight_drop_fork():
    f = facts("r3k3/8/8/8/8/8/8/4K3[N] w - - 0 1", "N@c7")
    assert {(p.square, p.piece) for p in f.attacks} == {("a8", "R"), ("e8", "K")}
    assert "knight_fork" in f.tags and "drop_check" in f.tags


def test_discovered_check_and_castling_is_not_discovered():
    f = facts("4k3/8/8/8/4N3/8/8/4RK2[] w - - 0 1", "Nc5")
    assert f.is_check and f.discovered_check and "discovered_check" in f.tags
    g = facts("5k2/8/8/8/8/8/8/4K2R[] w K - 0 1", "O-O")
    assert g.is_check and not g.discovered_check


def test_capturing_promoted_piece_is_marked():
    b = build_board("r3k3/1P6/1n6/8/8/8/8/4K3[] w - - 0 1", ["b7a8q"])
    f = move_facts(b, b.parse_san("Nxa8"))
    assert f.captured == "Q~" and f.pocket_after == ["P"]


def test_interposition_drop():
    b = board("4k3/8/8/8/4r3/8/8/4K3[N] w - - 0 1")
    f = move_facts(b, b.parse_san("N@e2"))
    assert "interposition_drop" in f.tags and not f.is_check
    king_move = move_facts(b, b.parse_san("Kd2"))
    assert "interposition_drop" not in king_move.tags


def test_pv_forcing_checks():
    b = board("6k1/5ppp/8/8/8/8/5PPP/6K1[RR] w - - 0 1")
    line = EngineLine(rank=1, evaluation=None, mate=1, depth=5, pv=[move_model(b, b.parse_san("R@e8"))])
    plies, checks = pv_facts(b, line)
    assert checks == 1 and plies[0].is_check and plies[0].is_drop and plies[0].color == "white"


def test_facts_on_every_ply_of_real_games_are_consistent():
    games = json.loads((Path(__file__).parent / "fixtures" / "lichess_finished_games.json").read_text())
    for game in games:
        node = import_pgn(game["pgn"]).root
        while node.children:
            child = node.children[0]
            b = build_board(node.state.root_fen, node.state.moves)
            pf = position_facts(b)
            assert pf.in_check == bool(pf.checkers) == b.is_check()
            assert pf.legal_move_count == len(node.state.legal_moves)
            mf = move_facts(b, chess.Move.from_uci(child.state.last_move.uci))
            assert mf.move == child.state.last_move
            assert mf.is_check == child.state.is_check
            assert mf.is_mate == (child.state.outcome is not None and child.state.outcome.termination == "checkmate")
            mover = "white" if b.turn else "black"
            assert mf.pocket_after == getattr(child.state.pockets, mover)
            node = child


def test_discovered_attack_when_a_piece_leaves_the_line():
    f = facts("3qk3/8/8/8/3N4/8/8/3RK3[] w - - 0 1", "Nf5")
    assert [(e.attacker, e.target) for e in f.discovered_attacks] == [("Rd1", "Qd8")]
    assert "discovered_attack" in f.tags


def test_discovered_check_is_reported_as_attack_on_king():
    f = facts("4k3/8/8/8/4N3/8/8/4RK2[] w - - 0 1", "Nc5")
    assert ("Re1", "Ke8") in [(e.attacker, e.target) for e in f.discovered_attacks]
    assert "discovered_check" in f.tags and "discovered_attack" not in f.tags


def test_castling_rook_is_not_a_discovered_attack():
    f = facts("3rk3/8/8/8/8/8/8/4K2R[] w K - 0 1", "O-O")
    assert f.discovered_attacks == []


def test_blocking_drop_cuts_the_enemy_line():
    f = facts("4k3/8/8/8/1b6/8/8/4K3[N] w - - 0 1", "N@d2")
    assert [(e.attacker, e.target) for e in f.blocked_lines] == [("Bb4", "Ke1")]
    assert {"blocks_line", "interposition_drop"} <= set(f.tags)
    # A move that stands on no enemy line blocks nothing.
    assert facts(STARTING_FEN, "e4").blocked_lines == []
    # Blocking an attack on the queen (not only checks).
    q = facts("4k3/8/8/b7/8/8/3Q4/4K3[P] w - - 0 1", "P@c3")
    assert [(e.attacker, e.target) for e in q.blocked_lines] == [("Ba5", "Qd2")]
    assert "interposition_drop" not in q.tags


def test_pawn_capture_opens_file():
    f = facts("4k3/8/8/3p4/4P3/8/8/4K3[] w - - 0 1", "exd5")
    assert f.opened_file.model_dump() == {"file": "e", "kind": "open"}
    half = facts("4k3/4p3/8/3p4/4P3/8/8/4K3[] w - - 0 1", "exd5")
    assert half.opened_file.model_dump() == {"file": "e", "kind": "half_open"}
    still = facts("4k3/8/8/3p4/4P3/8/4P3/4K3[] w - - 0 1", "exd5")
    assert still.opened_file is None and "opens_file" not in still.tags
    assert facts("4k3/8/8/8/8/8/4P3/4K3[] w - - 0 1", "e4").opened_file is None


def test_quiet_move_that_threatens_mate():
    f = facts("6k1/p4ppp/8/8/8/8/R4PPP/6K1[] w - - 0 1", "Re2")
    assert f.threatens_mate == ["Re8#"] and "mate_threat" in f.tags
    assert facts("6k1/p4ppp/8/8/8/8/R4PPP/6K1[] w - - 0 1", "h3").threatens_mate == []


def test_null_move_view():
    from app.analyzer import null_move_view

    view = null_move_view(board("6k1/5ppp/8/8/8/8/5PPP/6K1[r] w - - 0 1"))
    assert view is not None and view.turn == chess.BLACK
    in_check = build_board(STARTING_FEN, ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4", "e7e6", "N@d6"])
    assert null_move_view(in_check) is None
