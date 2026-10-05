"""Position, move and PGN endpoints. All rule decisions are delegated to chess_core."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..chess_core import IllegalMoveError, LineError, apply_move, normalize_root_fen, position_id, position_state
from ..models import GameTree, LineRequest, MoveRequest, PgnRequest, PositionState
from ..pgn_import import PgnError, import_pgn

router = APIRouter(prefix="/api")


def check_line(request: LineRequest) -> str:
    """Validate the line identity and return its normalized root FEN."""
    try:
        root_fen = normalize_root_fen(request.root_fen)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error
    if request.position_id is not None and request.position_id != position_id(root_fen, request.moves):
        raise HTTPException(
            status_code=409,
            detail={"error": "position_mismatch", "message": "position_id does not match root_fen + moves"},
        )
    return root_fen


@router.post("/position", response_model=PositionState)
def get_position(request: LineRequest) -> PositionState:
    root_fen = check_line(request)
    try:
        return position_state(root_fen, request.moves)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error


@router.post("/move", response_model=PositionState)
def play_move(request: MoveRequest) -> PositionState:
    root_fen = check_line(request)
    try:
        return apply_move(root_fen, request.moves, request.move)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error
    except IllegalMoveError as error:
        raise HTTPException(
            status_code=422, detail={"error": "illegal_move", "move": error.move, "message": error.reason}
        ) from error


@router.post("/pgn", response_model=GameTree)
def load_pgn(request: PgnRequest) -> GameTree:
    try:
        return import_pgn(request.pgn)
    except PgnError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_pgn", "message": str(error)}) from error
