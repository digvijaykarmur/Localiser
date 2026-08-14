"""FastAPI application — Localiser backend on :8420."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from localiser.config import get_settings
from localiser.db import init_db
from localiser.util import log


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_settings()
    init_db()
    log.info("localiser_api_start", workspace=str(cfg.workspace_root), models=cfg.models)
    yield
    try:
        from localiser.pipeline.typeset import close_browser

        await close_browser()
    except Exception:
        pass


def create_app() -> FastAPI:
    app = FastAPI(title="Localiser", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from localiser.api.routes import bible, chapters, chat, export, jobs, pages, series

    app.include_router(series.router, prefix="/api")
    app.include_router(bible.router, prefix="/api")
    app.include_router(chapters.router, prefix="/api")
    app.include_router(pages.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(jobs.router, prefix="/api")
    app.include_router(export.router, prefix="/api")

    @app.get("/api/health")
    def health():
        cfg = get_settings()
        return {
            "ok": True,
            "product": "Localiser",
            "models": cfg.models,
            "workspace": str(cfg.workspace_root),
        }

    return app


app = create_app()
