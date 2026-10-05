"""Crazyhouse rules and canonical position state.

python-chess ``CrazyhouseBoard`` is the single rules implementation of the
whole system. Every other layer (UI, engine, analyzer, LLM context) receives
positions produced here and identifies them by ``position_id``.
"""

from __future__ import annotations

import hashlib

import chess
from chess.variant import CrazyhouseBoard

from .models import Color, MoveModel, Outcome, Pockets, PositionState

STARTING_FEN = CrazyhouseBoard.starting_fen
MAX_LINE_LENGTH = 1000
POCKET_ORDER = (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN)
CASTLING_REASON = (
    "castling is not possible here (no castling right, pieces in between, "
    "or the king is in, passes through or lands on an attacked square)"
)


class LineError(ValueError):
    """The requested root FEN or move line is not a legal crazyhouse line."""


class IllegalMoveError(ValueError):
    """A move is not legal in the given position; ``reason`` is user-facing."""

    def __init__(self, move: str, reason: str) -> None:
        super().__init__(f"{move}: {reason}")
        self.move = move
        self.reason = reason


def color_name(color: chess.Color) -> Color:
    return "white" if color == chess.WHITE else "black"


def normalize_root_fen(root_fen: str | None) -> str:
    if not root_fen:
        return STARTING_FEN
    try:
        board = CrazyhouseBoard(root_fen)
    except ValueError as error:
        raise LineError(f"invalid crazyhouse FEN: {error}") from error
    if board.status() != chess.STATUS_VALID:
        raise LineError(f"invalid crazyhouse position: {board.status()!r}")
    return board.fen()


def position_id(root_fen: str, moves: list[str]) -> str:
    digest = hashlib.sha256(f"{root_fen}|{' '.join(moves)}".encode()).hexdigest()
    return digest[:16]


def build_board(root_fen: str, moves: list[str]) -> CrazyhouseBoard:
    """Replay ``moves`` (UCI) from ``root_fen``, validating every move."""
    if len(moves) > MAX_LINE_LENGTH:
        raise LineError(f"line longer than {MAX_LINE_LENGTH} plies")
    board = CrazyhouseBoard(root_fen)
    for index, uci in enumerate(moves):
        try:
            move = chess.Move.from_uci(uci)
        except ValueError as error:
            raise LineError(f"ply {index + 1}: malformed uci {uci!r}") from error
        if not board.is_legal(move):
            raise LineError(f"ply {index + 1}: illegal move {uci} in {board.fen()}")
        board.push(move)
    return board


def parse_move(board: CrazyhouseBoard, text: str) -> chess.Move:
    """Parse UCI or SAN text into a legal move, or raise IllegalMoveError with a reason."""
    text = text.strip()
    if not text:
        raise IllegalMoveError(text, "empty move")
    try:
        move = chess.Move.from_uci(text)
    except ValueError:
        try:
            return board.parse_san(text)
        except chess.IllegalMoveError:
            # Parsed as SAN but illegal: recover the intended move for a better reason.
            if text.rstrip("+#!?").replace("0", "O") in ("O-O", "O-O-O"):
                raise IllegalMoveError(text, CASTLING_REASON) from None
            move = _san_target(board, text)
            if move is None:
                raise IllegalMoveError(text, "illegal move in this position") from None
        except chess.AmbiguousMoveError:
            raise IllegalMoveError(text, "ambiguous move; specify the origin square") from None
        except ValueError:
            raise IllegalMoveError(text, "cannot parse move (use UCI like e2e4 / N@e7 or SAN like Nf3)") from None
    if not move:
        raise IllegalMoveError(text, "null moves are not allowed")
    if board.is_legal(move):
        return move
    raise IllegalMoveError(text, illegal_reason(board, move))


def _san_target(board: CrazyhouseBoard, text: str) -> chess.Move | None:
    """Recover the move an illegal SAN refers to, so the reason can be explained."""
    core = text.rstrip("+#!?")
    if "@" in core:
        uci = "P" + core if core.startswith("@") else core
        try:
            return chess.Move.from_uci(uci)
        except ValueError:
            return None
    matches = [
        move
        for move in board.generate_pseudo_legal_moves()
        if not board.is_legal(move) and board.san(move).rstrip("+#") == core
    ]
    return matches[0] if len(matches) == 1 else None


def illegal_reason(board: CrazyhouseBoard, move: chess.Move) -> str:
    side = color_name(board.turn)
    if move.drop:
        symbol = chess.piece_symbol(move.drop).upper()
        square = chess.square_name(move.to_square)
        if move.drop == chess.KING:
            return "the king can never be dropped"
        if board.pockets[board.turn].count(move.drop) == 0:
            return f"{side} has no {symbol} in the pocket"
        if board.piece_at(move.to_square):
            return f"{square} is occupied"
        if move.drop == chess.PAWN and chess.square_rank(move.to_square) in (0, 7):
            return "pawns cannot be dropped on the 1st or 8th rank"
        if board.is_check():
            return f"{side} is in check and a drop on {square} does not block it"
        return "illegal drop"
    piece = board.piece_at(move.from_square)
    if piece is None:
        return f"no piece on {chess.square_name(move.from_square)}"
    if piece.color != board.turn:
        return f"the piece on {chess.square_name(move.from_square)} is not {side}'s"
    if piece.piece_type == chess.KING and chess.square_distance(move.from_square, move.to_square) > 1:
        return CASTLING_REASON
    if board.is_pseudo_legal(move):
        if board.is_check():
            return f"{side} is in check and this move does not resolve it"
        return "the move would leave the king in check (pinned piece or king walks into attack)"
    if move.promotion is None and piece.piece_type == chess.PAWN and chess.square_rank(move.to_square) in (0, 7):
        return "a pawn reaching the last rank must promote"
    return f"the {chess.piece_name(piece.piece_type)} cannot move to {chess.square_name(move.to_square)}"


def move_model(board: CrazyhouseBoard, move: chess.Move) -> MoveModel:
    """Describe ``move`` played from ``board`` (the position before the move)."""
    san = board.san(move)
    if san.startswith("@"):
        san = "P" + san  # lichess-style pawn drop display
    return MoveModel(
        uci=move.uci(),
        san=san,
        from_square=None if move.drop else chess.square_name(move.from_square),
        to=chess.square_name(move.to_square),
        drop=chess.piece_symbol(move.drop).upper() if move.drop else None,
        promotion=chess.piece_symbol(move.promotion).upper() if move.promotion else None,
        is_capture=board.is_capture(move),
    )


def pocket_list(board: CrazyhouseBoard, color: chess.Color) -> list[str]:
    pocket = board.pockets[color]
    return [chess.piece_symbol(pt).upper() for pt in POCKET_ORDER for _ in range(pocket.count(pt))]


def position_state(root_fen: str, moves: list[str], board: CrazyhouseBoard | None = None) -> PositionState:
    """Build the canonical state for a line. ``board`` may be passed if already replayed."""
    root_fen = normalize_root_fen(root_fen)
    if board is None:
        board = build_board(root_fen, moves)
    last_move = None
    if board.move_stack:
        move = board.pop()
        last_move = move_model(board, move)
        board.push(move)
    outcome = board.outcome()
    return PositionState(
        position_id=position_id(root_fen, moves),
        root_fen=root_fen,
        moves=list(moves),
        ply=board.ply(),
        move_number=board.fullmove_number,
        fen=board.fen(),
        side_to_move=color_name(board.turn),
        pockets=Pockets(white=pocket_list(board, chess.WHITE), black=pocket_list(board, chess.BLACK)),
        promoted=[chess.square_name(sq) for sq in chess.scan_forward(board.promoted & board.occupied)],
        last_move=last_move,
        is_check=board.is_check(),
        outcome=None
        if outcome is None
        else Outcome(
            result=outcome.result(),
            termination=outcome.termination.name.lower(),
            winner=None if outcome.winner is None else color_name(outcome.winner),
        ),
        legal_moves=[] if outcome else [m.uci() for m in board.legal_moves],
    )


def apply_move(root_fen: str | None, moves: list[str], move_text: str) -> PositionState:
    """Play ``move_text`` after the line and return the child's canonical state."""
    root_fen = normalize_root_fen(root_fen)
    board = build_board(root_fen, moves)
    if board.is_game_over():
        raise IllegalMoveError(move_text, "the game is already over in this position")
    move = parse_move(board, move_text)
    board.push(move)
    return position_state(root_fen, [*moves, move.uci()], board)
