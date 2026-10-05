"""LLM explanations and Q&A about the active position."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..analyzer import insights as compute_insights
from ..chess_core import position_state
from ..llm.context import CONTEXT_VERSION, build_context
from ..llm.provider import LLMError, LLMUnavailable
from ..llm.service import DEFAULT_QUESTION, ExplainService
from ..models import ExplainRequest, ExplainResponse
from .engine import engine_service, run_engine

router = APIRouter(prefix="/api")


def explain_service(request: Request) -> ExplainService:
    return request.app.state.explain


@router.post("/explain", response_model=ExplainResponse)
async def explain(body: ExplainRequest, request: Request) -> ExplainResponse:
    service = explain_service(request)
    try:
        service.model  # fail fast before spending engine time
    except LLMUnavailable as error:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable", "message": str(error)}) from error

    root_fen, board, analysis = await run_engine(body, engine_service(request))
    if analysis.status == "cancelled":
        raise HTTPException(
            status_code=409, detail={"error": "engine_cancelled", "message": "Engine 分析被較新的局面取代，請再問一次"}
        )
    state = position_state(root_fen, body.moves, board)
    facts = compute_insights(root_fen, body.moves, board, analysis)
    context = build_context(body, state, analysis, facts)
    question = (body.question or "").strip() or DEFAULT_QUESTION
    try:
        result, request_id, cached = await service.ask(context, question, body.history)
    except LLMUnavailable as error:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable", "message": str(error)}) from error
    except LLMError as error:
        raise HTTPException(status_code=502, detail={"error": "llm_error", "message": str(error)}) from error
    return ExplainResponse(
        position_id=state.position_id,
        variation_id=body.variation_id,
        analysis_id=analysis.analysis_id,
        request_id=request_id,
        context_version=CONTEXT_VERSION,
        question=question,
        text=result.text if not result.refused else "",
        model=result.model,
        refused=result.refused,
        cached=cached,
    )
