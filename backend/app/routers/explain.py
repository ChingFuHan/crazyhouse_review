"""LLM explanations and Q&A about the active position (plain JSON and streamed SSE)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

from chess.variant import CrazyhouseBoard

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..analyzer import insights as compute_insights
from ..chess_core import LineError, build_board, position_state
from ..chess_core import position_id as position_id_of
from ..llm.candidates import CandidateCheck, analyse_candidates, extract_candidates, illegal_only_answer
from ..llm.context import CONTEXT_VERSION, build_context
from ..llm.grounding import check_answer
from ..llm.provider import LLMError, LLMResult, LLMUnavailable
from ..llm.service import DEFAULT_QUESTION, SYSTEM_PROMPT, ExplainService, build_messages, new_request_id
from ..models import ExplainRequest, ExplainResponse, PromptRecord
from .engine import background_engine, engine_service, has_lines, resolve_analysis, run_threat
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
    board: CrazyhouseBoard | None = None

    def prompt(self) -> PromptRecord | None:
        """Exactly what the model receives for this question (None when the rules answer it)."""
        if self.context is None:
            return None
        return PromptRecord(system=SYSTEM_PROMPT, messages=build_messages(self.context, self.question, self.body.history))

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
            warnings=check_answer(text, self.context, self.board)
            if self.context is not None and self.board is not None and text
            else [],
        )


def _llm_unavailable(error: LLMUnavailable) -> HTTPException:
    return HTTPException(status_code=503, detail={"error": "llm_unavailable", "message": str(error)})


async def prepare(body: ExplainRequest, request: Request) -> Prepared:
    """Validate, check named moves, run engine + analyzer, build the LLM context."""
    service = explain_service(request)
    background = background_engine(request)
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

    # Explain exactly the analysis on screen; anything else runs on the background engine (protected),
    # so asking never interrupts the interactive analysis.
    root_fen, board, analysis = await resolve_analysis(body, request)
    # Same time as the displayed search, but bounded: a long or infinite analysis must not make a
    # question wait minutes (up to MAX_ENGINE_SEARCHES searches) before the LLM even starts.
    defaults = engine_service(request).settings
    candidate_ms = min(analysis.movetime_ms or defaults.movetime_ms, defaults.max_movetime_ms)
    await analyse_candidates(prepared.checks, board, root_fen, body.moves, analysis, background, candidate_ms)
    threat = await run_threat(board, background, protected=True) if has_lines(analysis) else None
    state = position_state(root_fen, body.moves, board)
    facts = compute_insights(root_fen, body.moves, board, analysis, threat)
    prepared.analysis_id = analysis.analysis_id
    prepared.board = board
    prepared.context = build_context(body, state, analysis, facts, prepared.question)
    if prepared.checks:
        prepared.context["candidate_analysis"] = [c.context() for c in prepared.checks]
    return prepared


def _final(prepared: Prepared, request_id: str, result: LLMResult, cached: bool) -> ExplainResponse:
    response = prepared.response(request_id, "" if result.refused else result.text, result.model, result.refused, cached)
    response.prompt = prepared.prompt()
    return response


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
