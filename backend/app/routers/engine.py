"""Engine analysis and insights endpoints. The engine only ever sees positions built by chess_core."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import chess.variant
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..analyzer import insights as compute_insights
from ..analyzer import null_move_view, threat_from_line
from ..chess_core import LineError, build_board, position_id
from ..engine import EngineService, EngineUnavailable, analysis_id
from ..models import AnalyzeRequest, EngineAnalysis, Insights, StopRequest, StreamAnalyzeRequest, ThreatFacts
from .game import check_line

router = APIRouter(prefix="/api")


def engine_service(request: Request) -> EngineService:
    """The interactive engine: what the user watches in the engine panel."""
    return request.app.state.engine


def background_engine(request: Request) -> EngineService:
    """The second engine process (review jobs, threats, candidate checks, explanation fallbacks), so
    work the user did not watch never interrupts the interactive analysis."""
    return request.app.state.review.engine


def validated_line(body) -> tuple[str, str, chess.variant.CrazyhouseBoard]:
    root_fen = check_line(body)
    try:
        board = build_board(root_fen, body.moves)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error
    return root_fen, position_id(root_fen, body.moves), board


async def resolve_analysis(
    body: AnalyzeRequest, request: Request
) -> tuple[str, chess.variant.CrazyhouseBoard, EngineAnalysis]:
    """The engine result an explanation is about: exactly the displayed one when `analysis_id` names a
    result for this position, otherwise a protected search on the background engine."""
    if body.analysis_id:
        root_fen, pid, board = validated_line(body)
        for engine in (engine_service(request), background_engine(request)):
            found = engine.find(body.analysis_id)
            if found is not None and found.position_id == pid:
                return root_fen, board, found
    return await run_engine(body, background_engine(request), protected=True)


async def run_engine(
    body: AnalyzeRequest, engine: EngineService, protected: bool = False
) -> tuple[str, chess.variant.CrazyhouseBoard, EngineAnalysis]:
    """Validate the line and analyse it (cache-backed). ``protected``: see EngineService.analyse."""
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
        return root_fen, board, await engine.analyse(
            root_fen, body.moves, pid, multipv, movetime_ms, protected=protected, depth=body.depth
        )
    except EngineUnavailable as error:
        raise HTTPException(status_code=503, detail={"error": "engine_unavailable", "message": str(error)}) from error


async def run_threat(
    board: chess.variant.CrazyhouseBoard, engine: EngineService, protected: bool = False
) -> ThreatFacts | None:
    """Engine search of the null-move position: what the opponent would do if the side to move passed."""
    view = null_move_view(board)
    if view is None:
        return None
    fen = view.fen()
    try:
        analysis = await engine.analyse(
            fen, [], position_id(fen, []), 1, engine.settings.threat_movetime_ms, protected=protected
        )
    except EngineUnavailable:
        return None
    if analysis.status != "ok" or not analysis.lines:
        return None
    return threat_from_line(view, analysis.lines[0])


def has_lines(analysis: EngineAnalysis) -> bool:
    return analysis.status in ("ok", "running") and bool(analysis.lines)


@router.post("/analyze", response_model=EngineAnalysis)
async def analyze(body: AnalyzeRequest, request: Request) -> EngineAnalysis:
    _, _, analysis = await run_engine(body, engine_service(request))
    return analysis


@router.post("/insights", response_model=Insights)
async def insights(body: AnalyzeRequest, request: Request) -> Insights:
    """Engine result (the displayed one when `analysis_id` is given) + deterministic facts for the
    position, its last move and each candidate."""
    root_fen, board, analysis = await resolve_analysis(body, request)
    threat = await run_threat(board, background_engine(request), protected=True) if has_lines(analysis) else None
    return compute_insights(root_fen, body.moves, board, analysis, threat)


def _sse(event: str, analysis: EngineAnalysis) -> str:
    return f"event: {event}\ndata: {json.dumps(analysis.model_dump(mode='json', by_alias=True), ensure_ascii=False)}\n\n"


@router.post("/analyze/stream")
async def analyze_stream(body: StreamAnalyzeRequest, request: Request) -> StreamingResponse:
    """Server-sent events with the user's settings: `snapshot` while the search deepens, then `done`
    (status ok / cancelled / game_over) or `error`. Line errors are plain HTTP errors."""
    engine = engine_service(request)
    root_fen, pid, board = validated_line(body)
    settings = body.settings

    async def events() -> AsyncIterator[str]:
        if board.is_game_over():
            over = EngineAnalysis(
                position_id=pid, status="game_over", engine=engine.name, multipv=settings.multipv,
                movetime_ms=settings.movetime_ms, depth=0, lines=[], best_move=None,
                analysis_id=analysis_id(pid, engine.name, []), settings=settings,
            )  # fmt: skip
            yield _sse("done", over)
            return
        try:
            async for result in engine.stream(root_fen, body.moves, pid, settings):
                yield _sse("snapshot" if result.status == "running" else "done", result)
        except EngineUnavailable as error:
            yield f"event: error\ndata: {json.dumps({'error': 'engine_unavailable', 'message': str(error)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.post("/analyze/stop")
async def analyze_stop(body: StopRequest, request: Request) -> dict[str, bool]:
    """Finish the running analysis of this position now (its result counts as complete)."""
    return {"stopped": engine_service(request).stop(body.position_id)}
