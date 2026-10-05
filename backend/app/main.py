"""FastAPI application factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import EngineSettings, engine_settings
from .engine import EngineService
from .routers import engine, game


def create_app(settings: EngineSettings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.engine = EngineService(settings or engine_settings())
        yield
        await app.state.engine.close()

    app = FastAPI(title="Crazyhouse Review", lifespan=lifespan)
    app.include_router(game.router)
    app.include_router(engine.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
