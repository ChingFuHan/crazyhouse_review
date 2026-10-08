"""Whole-game review jobs (main line evaluation and critical moves)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..chess_core import IllegalMoveError, LineError, build_board, parse_move
from ..engine import EngineUnavailable
from ..models import JudgedMove, LineRequest, MoveRequest, ReviewJob
from ..review import ReviewService
from .game import check_line

router = APIRouter(prefix="/api")


def review_service(request: Request) -> ReviewService:
    return request.app.state.review


@router.post("/review", response_model=ReviewJob)
async def start_review(body: LineRequest, request: Request) -> ReviewJob:
    root_fen = check_line(body)
    try:
        build_board(root_fen, body.moves)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error
    return review_service(request).start(root_fen, body.moves)


@router.post("/review/judge", response_model=JudgedMove)
async def judge(body: MoveRequest, request: Request) -> JudgedMove:
    """A move tried in a position of the game (learning from mistakes), judged like the whole-game review."""
    root_fen = check_line(body)
    try:
        board = build_board(root_fen, body.moves)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error
    if board.is_game_over():
        raise HTTPException(status_code=422, detail={"error": "game_over", "message": "這個局面已經結束"})
    try:
        move = parse_move(board, body.move)
    except IllegalMoveError as error:
        raise HTTPException(status_code=422, detail={"error": "illegal_move", "message": error.reason}) from error
    try:
        return await review_service(request).judge(root_fen, body.moves, move)
    except EngineUnavailable as error:
        raise HTTPException(status_code=503, detail={"error": "engine_unavailable", "message": str(error)}) from error


@router.get("/review/{job_id}", response_model=ReviewJob)
async def get_review(job_id: str, request: Request) -> ReviewJob:
    job = review_service(request).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_review", "message": "review job not found"})
    return job
