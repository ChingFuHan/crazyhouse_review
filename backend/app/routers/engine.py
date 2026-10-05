"""Engine analysis and insights endpoints. The engine only ever sees positions built by chess_core."""

from __future__ import annotations

import chess.variant
from fastapi import APIRouter, HTTPException, Request

from ..analyzer import insights as compute_insights
from ..chess_core import LineError, build_board, position_id
from ..engine import EngineService, EngineUnavailable, analysis_id
from ..models import AnalyzeRequest, EngineAnalysis, Insights
from .game import check_line

router = APIRouter(prefix="/api")


def engine_service(request: Request) -> EngineService:
    return request.app.state.engine


async def run_engine(body: AnalyzeRequest, engine: EngineService) -> tuple[str, chess.variant.CrazyhouseBoard, EngineAnalysis]:
    """Validate the line and analyse it (cache-backed). Shared by /analyze and /insights."""
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
        return root_fen, board, EngineAnalysis(
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
        return root_fen, board, await engine.analyse(root_fen, body.moves, pid, multipv, movetime_ms)
    except EngineUnavailable as error:
        raise HTTPException(status_code=503, detail={"error": "engine_unavailable", "message": str(error)}) from error


@router.post("/analyze", response_model=EngineAnalysis)
async def analyze(body: AnalyzeRequest, request: Request) -> EngineAnalysis:
    _, _, analysis = await run_engine(body, engine_service(request))
    return analysis


@router.post("/insights", response_model=Insights)
async def insights(body: AnalyzeRequest, request: Request) -> Insights:
    """Engine result + deterministic facts for the position, its last move and each candidate."""
    root_fen, board, analysis = await run_engine(body, engine_service(request))
    return compute_insights(root_fen, body.moves, board, analysis)
