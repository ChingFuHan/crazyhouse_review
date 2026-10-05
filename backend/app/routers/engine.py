"""Engine analysis endpoint. The engine only ever sees positions built by chess_core."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..chess_core import LineError, build_board, position_id
from ..engine import EngineService, EngineUnavailable, analysis_id
from ..models import AnalyzeRequest, EngineAnalysis
from .game import check_line

router = APIRouter(prefix="/api")


def engine_service(request: Request) -> EngineService:
    return request.app.state.engine


@router.post("/analyze", response_model=EngineAnalysis)
async def analyze(body: AnalyzeRequest, request: Request) -> EngineAnalysis:
    engine = engine_service(request)
    settings = engine.settings
    root_fen = check_line(body)
    pid = position_id(root_fen, body.moves)
    multipv = body.multipv or settings.multipv
    movetime_ms = min(body.movetime_ms or settings.movetime_ms, settings.max_movetime_ms)
    try:
        board = build_board(root_fen, body.moves)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error
    if board.is_game_over():
        return EngineAnalysis(
            position_id=pid,
            status="game_over",
            engine=engine.name,
            multipv=multipv,
            movetime_ms=movetime_ms,
            depth=0,
            lines=[],
            best_move=None,
            analysis_id=analysis_id(pid, engine.name, []),
        )
    try:
        return await engine.analyse(root_fen, body.moves, pid, multipv, movetime_ms)
    except EngineUnavailable as error:
        raise HTTPException(status_code=503, detail={"error": "engine_unavailable", "message": str(error)}) from error
