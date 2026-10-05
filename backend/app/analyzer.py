"""Deterministic position analyzer: verifiable facts from python-chess and engine output.

Nothing here searches or evaluates: evaluations come from the engine, everything else is
computed exactly by the rules implementation. These facts are what explanations may cite
as verified.
"""

from __future__ import annotations

import chess
from chess.variant import CrazyhouseBoard

from .chess_core import build_board, color_name, move_model, pocket_list
from .models import (
    CandidateFacts,
    EngineAnalysis,
    EngineLine,
    Insights,
    MoveFacts,
    PieceOnSquare,
    PositionFacts,
    PvPly,
    SideFacts,
)

FORCED_REPLY_LIMIT = 3
VALUABLE = (chess.KING, chess.QUEEN, chess.ROOK)


def _piece(board: chess.Board, square: chess.Square) -> PieceOnSquare:
    piece = board.piece_at(square)
    assert piece is not None
    return PieceOnSquare(square=chess.square_name(square), piece=piece.symbol().upper(), color=color_name(piece.color))


def _names(squares) -> list[str]:
    return sorted(chess.square_name(sq) for sq in squares)


def _as_turn(board: CrazyhouseBoard, color: chess.Color) -> CrazyhouseBoard:
    """A copy with ``color`` to move (null move if needed) for 'what if it were their turn' facts."""
    copy = board.copy(stack=False)
    if copy.turn != color:
        copy.push(chess.Move.null())
    return copy


def king_escape_squares(board: CrazyhouseBoard, color: chess.Color) -> list[str]:
    """Squares the king of ``color`` could legally step to (castling excluded)."""
    view = _as_turn(board, color)
    king = view.king(color)
    return _names(
        {m.to_square for m in view.legal_moves if m.from_square == king and not m.drop and not view.is_castling(m)}
    )


def hanging_pieces(board: CrazyhouseBoard, color: chess.Color) -> list[PieceOnSquare]:
    """Pieces of ``color`` (king excluded) the opponent could legally capture and that are undefended."""
    view = _as_turn(board, not color)
    capturable = {m.to_square for m in view.generate_legal_captures()}
    return [
        _piece(board, square)
        for square in chess.scan_forward(board.occupied_co[color] & ~board.kings)
        if square in capturable and not board.is_attacked_by(color, square)
    ]


def attacked_valuables(board: CrazyhouseBoard, color: chess.Color) -> list[PieceOnSquare]:
    """Queens and rooks of ``color`` currently attacked by the opponent."""
    targets = board.occupied_co[color] & (board.queens | board.rooks)
    return [_piece(board, sq) for sq in chess.scan_forward(targets) if board.is_attacked_by(not color, sq)]


def drop_check_squares(board: CrazyhouseBoard, color: chess.Color) -> dict[str, list[str]]:
    """For each piece in ``color``'s pocket: empty squares where dropping it would check the enemy king.

    Pocket and rank rules are applied; whether the drop is legal right now (turn, own king in
    check) is not, so for the side not to move this describes the threat on its next turn.
    """
    enemy_king = board.king(not color)
    if enemy_king is None:
        return {}
    out: dict[str, list[str]] = {}
    probe = board.copy(stack=False)
    for piece_type in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN):
        if not board.pockets[color].count(piece_type):
            continue
        squares = []
        for square in chess.scan_forward(~board.occupied & chess.BB_ALL):
            if piece_type == chess.PAWN and chess.square_rank(square) in (0, 7):
                continue
            probe.set_piece_at(square, chess.Piece(piece_type, color))
            if probe.attacks_mask(square) & chess.BB_SQUARES[enemy_king]:
                squares.append(chess.square_name(square))
            probe.remove_piece_at(square)
        if squares:
            out[chess.piece_symbol(piece_type).upper()] = squares
    return out


def mating_moves(board: CrazyhouseBoard) -> list[str]:
    """SAN of every legal move that checkmates immediately."""
    out = []
    for move in board.legal_moves:
        if board.gives_check(move):
            board.push(move)
            mate = board.is_checkmate()
            board.pop()
            if mate:
                out.append(move_model(board, move).san)
    return out


def side_facts(board: CrazyhouseBoard, color: chess.Color) -> SideFacts:
    king = board.king(color)
    king_zone = chess.BB_KING_ATTACKS[king] if king is not None else 0
    return SideFacts(
        color=color_name(color),
        king_square=chess.square_name(king) if king is not None else None,
        king_escape_squares=king_escape_squares(board, color),
        king_zone_attacks=sum(1 for sq in chess.scan_forward(king_zone) if board.is_attacked_by(not color, sq)),
        pocket=pocket_list(board, color),
        hanging_pieces=hanging_pieces(board, color),
        attacked_queens_rooks=attacked_valuables(board, color),
        drop_check_squares=drop_check_squares(board, color),
    )


def position_facts(board: CrazyhouseBoard) -> PositionFacts:
    mover = board.turn
    threats: list[str] = []
    if not board.is_check() and not board.is_game_over():
        threats = mating_moves(_as_turn(board, not mover))
    return PositionFacts(
        side_to_move=color_name(mover),
        in_check=board.is_check(),
        checkers=[_piece(board, sq) for sq in chess.scan_forward(board.checkers_mask())],
        legal_move_count=board.legal_moves.count(),
        mate_in_one=mating_moves(board),
        opponent_mate_threats=threats,
        white=side_facts(board, chess.WHITE),
        black=side_facts(board, chess.BLACK),
    )


def move_facts(board: CrazyhouseBoard, move: chess.Move) -> MoveFacts:
    """Facts about ``move`` played from ``board`` (the position before it)."""
    mover, opponent = board.turn, not board.turn
    model = move_model(board, move)
    captured = None
    if board.is_capture(move):
        square = move.to_square
        if board.is_en_passant(move):
            square = chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square))
        piece = board.piece_at(square)
        captured = chess.piece_symbol(piece.piece_type).upper() if piece else None
        if piece and board.promoted & chess.BB_SQUARES[square]:
            captured = f"{captured}~"  # promoted piece: goes to the pocket as a pawn
    escape_before = king_escape_squares(board, opponent)
    gives_check = board.gives_check(move)

    after = board.copy(stack=False)
    after.push(move)
    target_mask = after.occupied_co[opponent] & (after.kings | after.queens | after.rooks)
    attacked = [_piece(after, sq) for sq in chess.scan_forward(after.attacks_mask(move.to_square) & target_mask)]
    discovered = gives_check and not board.is_castling(move) and not any(p.piece == "K" for p in attacked)
    replies = list(after.legal_moves)
    escape_after = king_escape_squares(after, opponent)
    is_mate = after.is_checkmate()

    tags: list[str] = []
    if model.drop:
        tags.append("drop")
        if gives_check:
            tags.append("drop_mate" if is_mate else "drop_check")
        if model.drop == "Q":
            tags.append("queen_drop")
        if board.is_check():
            tags.append("interposition_drop")
    elif is_mate:
        tags.append("mate")
    elif gives_check:
        tags.append("check")
    if discovered:
        tags.append("discovered_check")
    if len(attacked) >= 2:
        tags.append("knight_fork" if after.piece_type_at(move.to_square) == chess.KNIGHT else "double_attack")
    if len(escape_after) < len(escape_before):
        tags.append("escape_square_reduction")
    if captured:
        tags.append("capture")
    if move.promotion:
        tags.append("promotion")

    return MoveFacts(
        move=model,
        mover=color_name(mover),
        is_check=gives_check,
        is_mate=is_mate,
        is_capture=captured is not None,
        captured=captured,
        is_drop=model.drop is not None,
        is_promotion=move.promotion is not None,
        discovered_check=discovered,
        attacks=attacked,
        opponent_king_escape_before=escape_before,
        opponent_king_escape_after=escape_after,
        pocket_before=pocket_list(board, mover),
        pocket_after=pocket_list(after, mover),
        opponent_reply_count=len(replies),
        forced_replies=[move_model(after, r).san for r in replies] if len(replies) <= FORCED_REPLY_LIMIT else [],
        tags=tags,
    )


def pv_facts(board: CrazyhouseBoard, line: EngineLine) -> tuple[list[PvPly], int]:
    """Annotate the PV and count the mover's consecutive checks from its start."""
    plies = []
    walk = board.copy(stack=False)
    mover = walk.turn
    forcing_checks, streak_open = 0, True
    for model in line.pv:
        move = chess.Move.from_uci(model.uci)
        is_check = walk.gives_check(move)
        if walk.turn == mover:
            if is_check and streak_open:
                forcing_checks += 1
            elif not is_check:
                streak_open = False
        plies.append(
            PvPly(san=model.san, uci=model.uci, color=color_name(walk.turn), is_check=is_check, is_drop=model.drop is not None)
        )
        walk.push(move)
    return plies, forcing_checks


def candidate_facts(board: CrazyhouseBoard, analysis: EngineAnalysis) -> list[CandidateFacts]:
    out = []
    for line in analysis.lines:
        move = chess.Move.from_uci(line.pv[0].uci)
        plies, forcing_checks = pv_facts(board, line)
        out.append(
            CandidateFacts(
                rank=line.rank,
                evaluation=line.evaluation,
                mate=line.mate,
                depth=line.depth,
                facts=move_facts(board, move),
                pv=plies,
                forcing_checks=forcing_checks,
            )
        )
    return out


def insights(root_fen: str, moves: list[str], board: CrazyhouseBoard, analysis: EngineAnalysis) -> Insights:
    """Engine result + facts for the position at the end of the line, its last move and each candidate."""
    last_move = None
    if moves:
        last_move = move_facts(build_board(root_fen, moves[:-1]), chess.Move.from_uci(moves[-1]))
    return Insights(
        position_id=analysis.position_id,
        analysis_id=analysis.analysis_id,
        engine_status=analysis.status,
        position=position_facts(board),
        last_move=last_move,
        candidates=candidate_facts(board, analysis) if analysis.status == "ok" else [],
    )
