"""FastAPI application factory."""

from __future__ import annotations

from fastapi import FastAPI

from .routers import game


def create_app() -> FastAPI:
    app = FastAPI(title="Crazyhouse Review")
    app.include_router(game.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
