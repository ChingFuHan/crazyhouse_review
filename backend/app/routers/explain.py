"""LLM explanations and Q&A about the active position (plain JSON and streamed SSE)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..analyzer import insights as compute_insights
from ..chess_core import LineError, build_board, position_state
from ..chess_core import position_id as position_id_of
from ..llm.candidates import CandidateCheck, analyse_candidates, extract_candidates, illegal_only_answer
from ..llm.context import CONTEXT_VERSION, build_context
from ..llm.provider import LLMError, LLMResult, LLMUnavailable
from ..llm.service import DEFAULT_QUESTION, ExplainService, new_request_id
from ..models import ExplainRequest, ExplainResponse
from .engine import engine_service, run_engine, run_threat
from .game import check_line

router = APIRouter(prefix="/api")


def explain_service(request: Request) -> ExplainService:
    return request.app.state.explain


@dataclass
class Prepared:
    """Everything needed to answer, computed before any LLM call."""

    body: ExplainRequest
    position_id: str
    question: str
    checks: list[CandidateCheck]
    analysis_id: str = ""
    context: dict | None = None  # None: answered by the rules, no LLM
    rules_answer: str = ""

    def response(self, request_id: str, text: str, model: str, refused=False, cached=False) -> ExplainResponse:
        return ExplainResponse(
            position_id=self.position_id,
            variation_id=self.body.variation_id,
            analysis_id=self.analysis_id,
            request_id=request_id,
            context_version=CONTEXT_VERSION,
            question=self.question,
            text=text,
            model=model,
            refused=refused,
            cached=cached,
            checked_moves=[c.summary() for c in self.checks],
        )


def _llm_unavailable(error: LLMUnavailable) -> HTTPException:
    return HTTPException(status_code=503, detail={"error": "llm_unavailable", "message": str(error)})


async def prepare(body: ExplainRequest, request: Request) -> Prepared:
    """Validate, check named moves, run engine + analyzer, build the LLM context."""
    service = explain_service(request)
    engine = engine_service(request)
    root_fen = check_line(body)
    try:
        board = build_board(root_fen, body.moves)
    except LineError as error:
        raise HTTPException(status_code=422, detail={"error": "invalid_line", "message": str(error)}) from error
    prepared = Prepared(
        body=body,
        position_id=position_id_of(root_fen, body.moves),
        question=(body.question or "").strip() or DEFAULT_QUESTION,
        checks=extract_candidates(board, body.question or ""),
    )
    if prepared.checks and not any(c.legal for c in prepared.checks):
        # Illegal candidates are answered by the rules, never by the engine or the LLM.
        prepared.rules_answer = illegal_only_answer(prepared.checks)
        return prepared
    try:
        service.model  # fail fast before spending engine time
    except LLMUnavailable as error:
        raise _llm_unavailable(error) from error

    root_fen, board, analysis = await run_engine(body, engine)
    if analysis.status == "cancelled":
        raise HTTPException(
            status_code=409, detail={"error": "engine_cancelled", "message": "Engine 分析被較新的局面取代，請再問一次"}
        )
    await analyse_candidates(prepared.checks, board, root_fen, body.moves, analysis, engine)
    threat = await run_threat(board, engine) if analysis.status == "ok" else None
    state = position_state(root_fen, body.moves, board)
    facts = compute_insights(root_fen, body.moves, board, analysis, threat)
    prepared.analysis_id = analysis.analysis_id
    prepared.context = build_context(body, state, analysis, facts)
    if prepared.checks:
        prepared.context["candidate_analysis"] = [c.context() for c in prepared.checks]
    return prepared


def _final(prepared: Prepared, request_id: str, result: LLMResult, cached: bool) -> ExplainResponse:
    return prepared.response(request_id, "" if result.refused else result.text, result.model, result.refused, cached)


@router.post("/explain", response_model=ExplainResponse)
async def explain(body: ExplainRequest, request: Request) -> ExplainResponse:
    prepared = await prepare(body, request)
    request_id = new_request_id()
    if prepared.context is None:
        return prepared.response(request_id, prepared.rules_answer, "rules")
    try:
        result, cached = await explain_service(request).ask(prepared.context, prepared.question, body.history)
    except LLMUnavailable as error:
        raise _llm_unavailable(error) from error
    except LLMError as error:
        raise HTTPException(status_code=502, detail={"error": "llm_error", "message": str(error)}) from error
    return _final(prepared, request_id, result, cached)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/explain/stream")
async def explain_stream(body: ExplainRequest, request: Request) -> StreamingResponse:
    """Server-sent events: `meta` (ids), `delta` (text chunks), then `done` (final ExplainResponse) or
    `error`. Validation and engine errors are returned as normal HTTP errors before the stream opens."""
    prepared = await prepare(body, request)
    service = explain_service(request)
    request_id = new_request_id()

    async def events() -> AsyncIterator[str]:
        yield _sse("meta", prepared.response(request_id, "", "").model_dump(mode="json", by_alias=True))
        if prepared.context is None:
            yield _sse("done", prepared.response(request_id, prepared.rules_answer, "rules").model_dump(mode="json"))
            return
        try:
            async for item in service.ask_stream(prepared.context, prepared.question, body.history):
                if isinstance(item, tuple):
                    result, cached = item
                    yield _sse("done", _final(prepared, request_id, result, cached).model_dump(mode="json"))
                else:
                    yield _sse("delta", {"text": item})
        except (LLMUnavailable, LLMError) as error:
            kind = "llm_unavailable" if isinstance(error, LLMUnavailable) else "llm_error"
            yield _sse("error", {"error": kind, "message": str(error)})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
