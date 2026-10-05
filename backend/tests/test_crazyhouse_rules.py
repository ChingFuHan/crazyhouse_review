"""Crazyhouse rules regression suite (canonical state produced by chess_core)."""

import pytest
from chess.variant import CrazyhouseBoard

from app.chess_core import (
    STARTING_FEN,
    IllegalMoveError,
    LineError,
    apply_move,
    normalize_root_fen,
    position_id,
    position_state,
)

# 1. e4 Nf6 2. Nc3 Nxe4 3. Nxe4 -> white holds N, black holds P
KNIGHT_TRADE = ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4"]


def line(*moves: str) -> list[str]:
    return list(moves)


def test_normal_move_has_machine_and_display_identity():
    state = apply_move(None, [], "e4")
    move = state.last_move
    assert move.model_dump(by_alias=True) == {
        "uci": "e2e4",
        "san": "e4",
        "from": "e2",
        "to": "e4",
        "drop": None,
        "promotion": None,
        "is_capture": False,
    }
    assert state.side_to_move == "black"
    assert state.ply == 1
    assert state.pockets.white == [] and state.pockets.black == []


def test_capture_adds_piece_to_capturer_pocket():
    state = position_state(STARTING_FEN, KNIGHT_TRADE)
    assert state.pockets.white == ["N"]
    assert state.pockets.black == ["P"]
    assert state.last_move.is_capture
    assert state.fen.startswith("rnbqkb1r/pppppppp/8/8/4N3/8/PPPP1PPP/R1BQKBNR[Np] b")


def test_pocket_drop_removes_piece_and_reports_drop_move():
    state = apply_move(None, [*KNIGHT_TRADE, "e7e6"], "N@d6+")
    move = state.last_move
    assert (move.uci, move.san, move.from_square, move.to, move.drop) == ("N@d6", "N@d6+", None, "d6", "N")
    assert state.pockets.white == []
    assert state.is_check, "drop check must be detected"


def test_drop_moves_are_listed_as_legal_moves():
    state = position_state(STARTING_FEN, [*KNIGHT_TRADE, "e7e6"])
    drops = {uci for uci in state.legal_moves if "@" in uci}
    assert "N@d6" in drops
    assert all(uci.startswith("N@") for uci in drops), "white only holds a knight"
    assert "N@e6" not in drops, "occupied square"


@pytest.mark.parametrize(
    ("moves", "move", "reason"),
    [
        ([*KNIGHT_TRADE, "e7e6"], "N@e6", "e6 已經有棋子"),
        ([*KNIGHT_TRADE, "e7e6"], "Q@h5", "白方的 pocket 裡沒有后"),
        ([*KNIGHT_TRADE, "e7e6"], "K@h5", "王不能被打入"),
        ([*KNIGHT_TRADE, "e7e6", "N@d6"], "P@a6", "黑方正被將軍，打入 a6 擋不住將軍"),
    ],
)
def test_illegal_drops_are_rejected_with_reason(moves, move, reason):
    with pytest.raises(IllegalMoveError) as error:
        apply_move(None, moves, move)
    assert reason in error.value.reason


@pytest.mark.parametrize("square", ["b8", "a1", "h1", "d8"])
def test_pawn_cannot_be_dropped_on_first_or_last_rank(square):
    fen = "4k3/8/8/8/8/8/8/4K3[P] w - - 0 1"
    with pytest.raises(IllegalMoveError) as error:
        apply_move(fen, [], f"P@{square}")
    assert "兵不能打入第 1 或第 8 橫列" in error.value.reason
    assert not any(uci == f"P@{square}" for uci in position_state(fen, []).legal_moves)


@pytest.mark.parametrize("square", ["e2", "a7", "h4"])
def test_pawn_drop_allowed_on_ranks_two_to_seven(square):
    state = apply_move("4k3/8/8/8/8/8/8/4K3[P] w - - 0 1", [], f"P@{square}")
    assert state.last_move.san == f"P@{square}"
    assert state.pockets.white == []


def test_pawn_drop_san_without_letter_is_accepted():
    state = apply_move("4k3/8/8/8/8/8/8/4K3[P] w - - 0 1", [], "@e3")
    assert state.last_move.uci == "P@e3"


def test_drop_mate_with_rook():
    state = apply_move("6k1/5ppp/8/8/8/8/5PPP/6K1[R] w - - 0 1", [], "R@e8")
    assert state.last_move.san == "R@e8#"
    assert state.outcome is not None
    assert (state.outcome.termination, state.outcome.winner, state.outcome.result) == ("checkmate", "white", "1-0")
    assert state.legal_moves == []


def test_pawn_drop_mate_is_legal_in_crazyhouse():
    state = apply_move("7k/7p/8/7N/8/8/B7/K7[P] w - - 0 1", [], "P@g7")
    assert state.last_move.san == "P@g7#"
    assert state.outcome.termination == "checkmate"


PROMOTION_FEN = "r3k3/1P6/1n6/8/8/8/8/4K3[] w - - 0 1"


def test_promotion_capture_marks_promoted_piece():
    state = apply_move(PROMOTION_FEN, [], "bxa8=Q+")
    move = state.last_move
    assert (move.uci, move.promotion, move.is_capture) == ("b7a8q", "Q", True)
    assert state.pockets.white == ["R"]
    assert state.promoted == ["a8"]
    assert state.fen.startswith("Q~")


def test_captured_promoted_queen_returns_to_pocket_as_pawn():
    state = apply_move(PROMOTION_FEN, ["b7a8q"], "Nxa8")
    assert state.pockets.black == ["P"], "a captured promoted piece goes to the pocket as a pawn"
    assert "Q" not in state.pockets.black
    assert state.promoted == []


def test_promoted_flag_survives_fen_round_trip():
    promoted = position_state(PROMOTION_FEN, ["b7a8q"])
    # Restart from the serialized FEN: the promoted marker must not be lost.
    restarted = apply_move(promoted.fen, [], "Nxa8")
    assert restarted.pockets.black == ["P"]


@pytest.mark.parametrize(
    "fen",
    [
        STARTING_FEN,
        "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R[QRBNPqrbnp] w KQkq - 2 3",
        "Q~3k3/8/1n6/8/8/8/8/4K3[R] b - - 0 1",
    ],
)
def test_crazyhouse_fen_round_trip(fen):
    state = position_state(fen, [])
    assert state.fen == fen
    assert CrazyhouseBoard(state.fen).fen() == fen


def test_pockets_are_reported_strongest_first():
    state = position_state("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R[PNQPRB] w KQkq - 2 3", [])
    assert state.pockets.white == ["Q", "R", "B", "N", "P", "P"]


def test_pinned_piece_move_is_illegal():
    with pytest.raises(IllegalMoveError) as error:
        apply_move("4k3/4r3/8/8/8/8/4N3/4K3[] w - - 0 1", [], "Nc3")
    assert "會讓自己的王被將軍" in error.value.reason


def test_checkmate_by_normal_move():
    state = position_state(STARTING_FEN, ["f2f3", "e7e5", "g2g4", "d8h4"])
    assert state.is_check
    assert state.outcome.termination == "checkmate" and state.outcome.winner == "black"


def test_invalid_line_is_rejected():
    with pytest.raises(LineError):
        position_state(STARTING_FEN, ["e2e5"])
    with pytest.raises(LineError):
        normalize_root_fen("not a fen")
    with pytest.raises(LineError):
        normalize_root_fen("8/8/8/8/8/8/8/8[] w - - 0 1")


def test_position_id_identifies_the_line():
    a = position_state(STARTING_FEN, ["g1f3", "g8f6", "b1c3"])
    b = position_state(STARTING_FEN, ["b1c3", "g8f6", "g1f3"])
    assert a.fen == b.fen, "transposition reaches the same FEN"
    assert a.position_id != b.position_id, "but a different line is a different position_id"
    assert a.position_id == position_id(STARTING_FEN, ["g1f3", "g8f6", "b1c3"])
    assert position_state(STARTING_FEN, ["g1f3", "g8f6", "b1c3"]).position_id == a.position_id


@pytest.mark.parametrize(
    ("fen", "move", "reason"),
    [
        (STARTING_FEN, "0000", "不允許空著"),
        (STARTING_FEN, "e2e5", "兵不能走到 e5"),
        (STARTING_FEN, "e7e5", "e7 上的棋子不是白方的"),
        (STARTING_FEN, "e3e4", "e3 上沒有棋子"),
        (STARTING_FEN, "hello", "無法解析棋步"),
        (STARTING_FEN, "Qxf7", "沒有后能走到 f7"),
        ("4k3/8/8/8/8/8/8/4K3[P] w - - 0 1", "Nf3", "白方盤上沒有馬"),
        ("4k3/8/8/8/8/8/8/1N2KN2[] w - - 0 1", "Nd2", "歧義"),
        ("4k3/1P6/8/8/8/8/8/4K3[] w - - 0 1", "b7b8", "必須升變"),
        # Castling through an attacked square (f1 attacked by the bishop on c4).
        ("4k3/8/8/8/2b5/8/8/4K2R[] w K - 0 1", "O-O", "現在不能易位"),
        ("4k3/8/8/8/2b5/8/8/4K2R[] w K - 0 1", "e1g1", "現在不能易位"),
    ],
)
def test_illegal_move_reasons(fen, move, reason):
    with pytest.raises(IllegalMoveError) as error:
        apply_move(fen, [], move)
    assert reason in error.value.reason


def test_castling_rights_lost_after_rook_captured_even_if_rook_dropped_back():
    # Black bishop takes the h1 rook; white later drops a rook back on h1: no castling.
    fen = "4k3/8/8/8/8/8/6b1/4K2R[RR] b K - 0 1"
    state = apply_move(fen, [], "Bxh1")
    assert " - " in state.fen, "castling right removed with the captured rook"
    state = position_state(fen, ["g2h1", "R@a3", "h1d5", "R@h1", "e8d8"])
    assert state.side_to_move == "white"
    assert "e1g1" not in state.legal_moves
