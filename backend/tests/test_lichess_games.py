"""Real lichess crazyhouse games: our replay must reach lichess's own final FEN."""

import json
from collections import Counter
from pathlib import Path

import pytest

from app.chess_core import position_state
from app.pgn_import import import_pgn

GAMES = json.loads((Path(__file__).parent / "fixtures" / "lichess_finished_games.json").read_text())


def comparable(fen: str):
    """(board without promoted markers, pocket multiset, side, castling) from either FEN style."""
    board, side, castling, *_ = fen.split()
    if board.endswith("]"):
        board, pocket = board[:-1].split("[")
    else:
        rows = board.split("/")
        board, pocket = "/".join(rows[:8]), (rows[8] if len(rows) == 9 else "")
    return board.replace("~", ""), Counter(pocket), side, castling


@pytest.mark.parametrize("game", GAMES, ids=[g["id"] for g in GAMES])
def test_replay_matches_lichess_final_position(game):
    node = import_pgn(game["pgn"]).root
    while node.children:
        node = node.children[0]
        assert node.state == position_state(node.state.root_fen, node.state.moves)
    assert comparable(node.state.fen) == comparable(game["lichess_last_fen"])
    assert node.state.outcome is not None and node.state.outcome.termination == "checkmate"
