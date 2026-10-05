"""Whole-game review jobs (main line evaluation and critical moves)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..chess_core import LineError, build_board
from ..models import LineRequest, ReviewJob
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


@router.get("/review/{job_id}", response_model=ReviewJob)
async def get_review(job_id: str, request: Request) -> ReviewJob:
    job = review_service(request).get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail={"error": "unknown_review", "message": "review job not found"})
    return job
