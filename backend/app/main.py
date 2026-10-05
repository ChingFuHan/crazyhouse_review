"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

from .config import REPO_ROOT, EngineSettings, LLMSettings, engine_settings, llm_settings
from .engine import EngineService
from .llm.provider import AnthropicProvider, FakeProvider, LLMProvider, LLMUnavailable
from .llm.service import ExplainService
from .routers import engine, explain, game


def make_explain_service(settings: LLMSettings) -> ExplainService:
    provider: LLMProvider
    if settings.provider == "fake":
        provider = FakeProvider()
    elif settings.provider == "anthropic":
        try:
            provider = AnthropicProvider(settings.model, settings.effort, settings.max_tokens)
        except LLMUnavailable as error:
            return ExplainService(None, str(error))
    else:
        return ExplainService(None, "LLM 已停用（LLM_PROVIDER=none）")
    return ExplainService(provider)


def create_app(settings: EngineSettings | None = None, explain_service: ExplainService | None = None) -> FastAPI:
    load_dotenv(REPO_ROOT / ".env", override=False)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.engine = EngineService(settings or engine_settings())
        app.state.explain = explain_service or make_explain_service(llm_settings())
        yield
        await app.state.engine.close()

    app = FastAPI(title="Crazyhouse Review", lifespan=lifespan)
    app.include_router(game.router)
    app.include_router(engine.router)
    app.include_router(explain.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
