from app.chess_core import STARTING_FEN, build_board
from app.llm.grounding import normalize, unverified_moves

BOARD = build_board(STARTING_FEN, ["e2e4", "g8f6", "b1c3", "f6e4", "c3e4", "e7e6"])
CONTEXT = {
    "engine": {"multipv": [{"pv": "4.Nf3 P@f6 5.d4 d5"}, {"pv": "4.Ng3 e5"}]},
    "analysis": {"threat_if_side_to_move_passes": {"best_move": "Bb4", "pv": ["Bb4", "a3"]}},
    "game": {"recent_moves": "1.e4 Nf6 2.Nc3 Nxe4 3.Nxe4 e6"},
}


def test_normalize():
    assert normalize("@e4+") == "P@e4"
    assert normalize("exd8=Q#") == "exd8Q"
    assert normalize("0-0-0") == "O-O-O"


def test_moves_from_context_or_legal_now_are_grounded():
    answer = "最佳著 Nf3 之後黑方會 P@f6；也可以考慮 N@d6+，但 Qh5 比較慢。實戰 3...e6 後白方 Ng3 也可行。"
    assert unverified_moves(answer, CONTEXT, BOARD) == []


def test_invented_moves_are_flagged_once():
    answer = "白方應走 Qxf7#，接著 Bxh7 與 R@h8；Qxf7# 是殺棋。e5 這格很重要。"
    assert unverified_moves(answer, CONTEXT, BOARD) == ["Qxf7#", "Bxh7", "R@h8"]
