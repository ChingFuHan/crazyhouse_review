"""Crazyhouse PGN import into a tree of canonical position states.

PGN text (headers, comments, player names) is untrusted data: it is parsed
and returned as data only, never interpreted as instructions.
"""

from __future__ import annotations

import io

import chess.pgn
from chess.variant import CrazyhouseBoard

from .chess_core import STARTING_FEN, LineError, normalize_root_fen, position_state
from .models import ExportNode, GameNode, GameTree

CRAZYHOUSE_ALIASES = {alias.lower() for alias in CrazyhouseBoard.aliases} | {"crazyhouse"}


class PgnError(ValueError):
    pass


class _CrazyhouseGameBuilder(chess.pgn.GameBuilder):
    """Assumes crazyhouse when the Variant tag is missing; rejects other variants."""

    def __init__(self) -> None:
        super().__init__()
        self.variant_assumed = False

    def end_headers(self):  # type: ignore[override]
        headers = self.game.headers
        variant = headers.get("Variant", "").strip()
        if not variant:
            headers["Variant"] = "Crazyhouse"
            self.variant_assumed = True
        elif variant.lower() not in CRAZYHOUSE_ALIASES:
            raise PgnError(f"only crazyhouse games are supported (PGN Variant is {variant!r})")
        return super().end_headers()


def import_pgn(text: str) -> GameTree:
    builder = _CrazyhouseGameBuilder()
    game = chess.pgn.read_game(io.StringIO(text), Visitor=lambda: builder)
    if game is None:
        raise PgnError("no game found in PGN")
    if game.errors:
        raise PgnError(f"PGN error: {game.errors[0]}")
    if not isinstance(game.board(), CrazyhouseBoard):
        raise PgnError("PGN did not produce a crazyhouse board")

    root_board = game.board()
    root_fen = normalize_root_fen(root_board.fen())
    try:
        root = _build_node(game, root_fen, [], CrazyhouseBoard(root_fen))
    except LineError as error:
        raise PgnError(str(error)) from error
    headers = {key: value for key, value in game.headers.items()}
    return GameTree(headers=headers, variant_assumed=builder.variant_assumed, root=root)


def _build_node(node: chess.pgn.GameNode, root_fen: str, moves: list[str], board: CrazyhouseBoard) -> GameNode:
    """Build ``node`` and its subtree; ``board`` is the position at ``node``.

    Iterates along the mainline so recursion depth only grows with variation nesting.
    """
    out = GameNode(state=position_state(root_fen, moves, board), comment=node.comment)
    current_out, current_in, current_moves = out, node, moves
    while current_in.variations:
        main, *sidelines = current_in.variations
        for side in sidelines:
            side_board = board.copy()
            _push_checked(side_board, side.move)
            current_out.children.append(_build_node(side, root_fen, [*current_moves, side.move.uci()], side_board))
        _push_checked(board, main.move)
        current_moves = [*current_moves, main.move.uci()]
        child = GameNode(state=position_state(root_fen, current_moves, board), comment=main.comment)
        current_out.children.insert(0, child)
        current_out, current_in = child, main
    return out


def _push_checked(board: CrazyhouseBoard, move: chess.Move) -> None:
    if not board.is_legal(move):
        raise LineError(f"illegal move {move.uci()} in {board.fen()}")
    board.push(move)


SEVEN_TAG_ROSTER = ("Event", "Site", "Date", "Round", "White", "Black", "Result")


def export_pgn(root_fen: str | None, headers: dict[str, str], nodes: list[ExportNode]) -> str:
    """Build a crazyhouse PGN from tree nodes (pre-order, main continuation first). Every move is
    re-validated by replaying it; a node whose parent line is missing is rejected."""
    root_fen = normalize_root_fen(root_fen)
    game = chess.pgn.Game()
    for key, value in headers.items():
        if key not in ("Variant", "FEN", "SetUp"):
            game.headers[key] = value
    for key in SEVEN_TAG_ROSTER:
        game.headers.setdefault(key, "?" if key != "Result" else "*")
    if root_fen != STARTING_FEN:
        game.setup(CrazyhouseBoard(root_fen))
    game.headers["Variant"] = "Crazyhouse"  # after setup(), which rewrites the variant tags

    by_line: dict[tuple[str, ...], chess.pgn.GameNode] = {(): game}
    for node in nodes:
        line = tuple(node.moves)
        if not line:
            game.comment = node.comment
            continue
        parent = by_line.get(line[:-1])
        if parent is None:
            raise PgnError(f"node {' '.join(line)} comes before its parent line")
        if line in by_line:
            continue
        try:
            move = chess.Move.from_uci(line[-1])
        except ValueError as error:
            raise PgnError(f"malformed move {line[-1]!r}") from error
        if not parent.board().is_legal(move):
            raise PgnError(f"illegal move {line[-1]} after {' '.join(line[:-1]) or 'the start'}")
        by_line[line] = parent.add_variation(move, comment=node.comment)
    return str(game) + "\n"
