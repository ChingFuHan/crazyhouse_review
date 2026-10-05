"""LLM explanations and Q&A about the active position."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request

from ..analyzer import insights as compute_insights
from ..chess_core import LineError, build_board, position_state
from ..chess_core import position_id as position_id_of
from ..llm.candidates import analyse_candidates, extract_candidates, illegal_only_answer
from ..llm.context import CONTEXT_VERSION, build_context
from ..llm.provider import LLMError, LLMUnavailable
from ..llm.service import DEFAULT_QUESTION, ExplainService
from ..models import ExplainRequest, ExplainResponse
from .engine import engine_service, run_engine
from .game import check_line

router = APIRouter(prefix="/api")


def explain_service(request: Request) -> ExplainService:
    return request.app.state.explain


@router.post("/explain", response_model=ExplainResponse)
async def explain(body: ExplainRequest, request: Request) -> ExplainResponse:
    service = explain_service(request)
    engine = engine_service(request)
    root_fen = check_line(body)
    try:
        board = build_board(root_fen, body.moves)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error
    question = (body.question or "").strip() or DEFAULT_QUESTION
    checks = extract_candidates(board, body.question or "")

    def respond(text: str, model: str, analysis_id: str, request_id: str, refused=False, cached=False):
        return ExplainResponse(
            position_id=position_id_of(root_fen, body.moves),
            variation_id=body.variation_id,
            analysis_id=analysis_id,
            request_id=request_id,
            context_version=CONTEXT_VERSION,
            question=question,
            text=text,
            model=model,
            refused=refused,
            cached=cached,
            checked_moves=[c.summary() for c in checks],
        )

    if checks and not any(c.legal for c in checks):
        # Illegal candidates are answered by the rules, never by the engine or the LLM.
        return respond(illegal_only_answer(checks), "rules", "", uuid.uuid4().hex[:12])
    try:
        service.model  # fail fast before spending engine time
    except LLMUnavailable as error:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable", "message": str(error)}) from error

    root_fen, board, analysis = await run_engine(body, engine)
    if analysis.status == "cancelled":
        raise HTTPException(
            status_code=409, detail={"error": "engine_cancelled", "message": "Engine 分析被較新的局面取代，請再問一次"}
        )
    await analyse_candidates(checks, board, root_fen, body.moves, analysis, engine)
    state = position_state(root_fen, body.moves, board)
    facts = compute_insights(root_fen, body.moves, board, analysis)
    context = build_context(body, state, analysis, facts)
    if checks:
        context["candidate_analysis"] = [c.context() for c in checks]
    try:
        result, request_id, cached = await service.ask(context, question, body.history)
    except LLMUnavailable as error:
        raise HTTPException(status_code=503, detail={"error": "llm_unavailable", "message": str(error)}) from error
    except LLMError as error:
        raise HTTPException(status_code=502, detail={"error": "llm_error", "message": str(error)}) from error
    return respond(result.text if not result.refused else "", result.model, analysis.analysis_id, request_id, result.refused, cached)
