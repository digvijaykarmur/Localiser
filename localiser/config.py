"""Application configuration and latest Vertex Gemini model defaults."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Strictly latest Gemini models on Vertex (as of 2026-08).
# Flash line: gemini-3.7-flash is newest; Pro line: gemini-3.1-pro-preview.
LATEST_MODELS = {
    "vision_bulk": "gemini-3.7-flash",
    "vision_deep": "gemini-3.1-pro-preview",
    "story": "gemini-3.1-pro-preview",
    "dialogue": "gemini-3.7-flash",
    "review": "gemini-3.1-pro-preview",
}

# Fallbacks if a region lacks a preview/newest ID.
MODEL_FALLBACKS = {
    "gemini-3.7-flash": ["gemini-3.6-flash", "gemini-3.5-flash"],
    "gemini-3.1-pro-preview": ["gemini-3.1-pro", "gemini-2.5-pro"],
    "gemini-3.6-flash": ["gemini-3.5-flash", "gemini-2.5-flash"],
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_application_credentials: str | None = Field(
        default=None, alias="GOOGLE_APPLICATION_CREDENTIALS"
    )
    gcp_project: str | None = Field(default=None, alias="GCP_PROJECT")
    gcp_location: str = Field(default="asia-south1", alias="GCP_LOCATION")
    workspace: Path = Field(default=Path("./workspace_data"), alias="WORKSPACE")
    api_host: str = Field(default="127.0.0.1", alias="API_HOST")
    api_port: int = Field(default=8420, alias="API_PORT")
    vertex_concurrency: int = Field(default=6, alias="VERTEX_CONCURRENCY")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    db_filename: str = "localiser.db"

    # Always pin to latest; override only via env if needed for debugging.
    model_vision_bulk: str = Field(
        default=LATEST_MODELS["vision_bulk"], alias="MODEL_VISION_BULK"
    )
    model_vision_deep: str = Field(
        default=LATEST_MODELS["vision_deep"], alias="MODEL_VISION_DEEP"
    )
    model_story: str = Field(default=LATEST_MODELS["story"], alias="MODEL_STORY")
    model_dialogue: str = Field(
        default=LATEST_MODELS["dialogue"], alias="MODEL_DIALOGUE"
    )
    model_review: str = Field(default=LATEST_MODELS["review"], alias="MODEL_REVIEW")

    @property
    def models(self) -> dict[str, str]:
        return {
            "vision_bulk": self.model_vision_bulk,
            "vision_deep": self.model_vision_deep,
            "story": self.model_story,
            "dialogue": self.model_dialogue,
            "review": self.model_review,
        }

    @property
    def workspace_root(self) -> Path:
        p = self.workspace.expanduser().resolve()
        p.mkdir(parents=True, exist_ok=True)
        (p / "input").mkdir(exist_ok=True)
        (p / "projects").mkdir(exist_ok=True)
        (p / "output").mkdir(exist_ok=True)
        return p

    @property
    def db_path(self) -> Path:
        return self.workspace_root / self.db_filename

    @property
    def prompts_dir(self) -> Path:
        return Path(__file__).resolve().parent.parent / "prompts"

    @property
    def assets_dir(self) -> Path:
        return Path(__file__).resolve().parent.parent / "assets"

    @property
    def fonts_dir(self) -> Path:
        return self.assets_dir / "fonts"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def slugify(title: str) -> str:
    import re

    s = title.strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[\s_-]+", "-", s).strip("-")
    return s or "untitled"


ReadingDir = Literal["ltr", "rtl"]
PageFormat = Literal["page", "longstrip"]
NamePolicy = Literal["transliterate", "indianize"]
