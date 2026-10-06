"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .access import ClientNetworkAllowlist, IPNetwork
from .config import (
    REPO_ROOT,
    EngineSettings,
    LLMSettings,
    allowed_client_networks,
    engine_settings,
    llm_settings,
    review_engine_settings,
)
from .engine import EngineService
from .llm.catalog import ProviderPool
from .llm.provider import AgyProvider, AnthropicProvider, FakeProvider, LLMProvider, LLMUnavailable
from .llm.service import ExplainService
from .review import ReviewService
from .routers import engine, explain, game, review


def make_explain_service(settings: LLMSettings) -> ExplainService:
    provider: LLMProvider
    try:
        if settings.provider == "fake":
            provider = FakeProvider()
        elif settings.provider == "anthropic":
            provider = AnthropicProvider(settings.model, settings.effort, settings.max_tokens)
        elif settings.provider == "agy":
            provider = AgyProvider(settings.agy_path, settings.model, None, settings.agy_timeout_s)
        else:
            return ExplainService(None, "LLM 未設定：請在 .env 設定 ANTHROPIC_API_KEY，或安裝並登入 agy CLI")
    except LLMUnavailable as error:
        return ExplainService(None, str(error))
    return ExplainService(provider)


def create_app(
    settings: EngineSettings | None = None,
    explain_service: ExplainService | None = None,
    review_settings: EngineSettings | None = None,
    frontend_dist: Path | None = REPO_ROOT / "frontend" / "dist",
    allowed_networks: list[IPNetwork] | None = None,
) -> FastAPI:
    load_dotenv(REPO_ROOT / ".env", override=False)
    networks = allowed_networks if allowed_networks is not None else allowed_client_networks()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.engine = EngineService(settings or engine_settings())
        llm = llm_settings()
        app.state.explain = explain_service or make_explain_service(llm)
        app.state.llm_pool = ProviderPool(llm.cli_paths or {}, llm.agy_timeout_s)
        review_engine = review_settings or review_engine_settings()
        app.state.review = ReviewService(EngineService(review_engine), review_engine.movetime_ms)
        yield
        await app.state.engine.close()
        await app.state.review.close()
        app.state.explain.close()
        app.state.llm_pool.close()

    app = FastAPI(title="Crazyhouse Review", lifespan=lifespan)
    if networks:
        app.add_middleware(ClientNetworkAllowlist, networks=networks)
    app.include_router(game.router)
    app.include_router(engine.router)
    app.include_router(explain.router)
    app.include_router(review.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # Serve the built UI (npm run build) from the same process, after the API routes.
    if frontend_dist is not None and (frontend_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    return app


app = create_app()
