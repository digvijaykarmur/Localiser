"""Global configuration and per-series config (series.json)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

# ---------------------------------------------------------------------------
# Latest Gemini models (August 2026). NN rule from the owner: strictly the
# latest models. A fallback chain handles regional availability gaps; the
# resolved model is logged and shown by `cli doctor`.
# ---------------------------------------------------------------------------
LATEST_FLASH = "gemini-3.7-flash"
LATEST_PRO = "gemini-3.1-pro-preview"

MODEL_FALLBACK_CHAIN: dict[str, list[str]] = {
    "gemini-3.7-flash": ["gemini-3.6-flash", "gemini-3.5-flash"],
    "gemini-3.1-pro-preview": ["gemini-3.1-pro", "gemini-3.6-flash"],
}

DEFAULT_MODELS = {
    "vision_bulk": LATEST_FLASH,
    "vision_deep": LATEST_PRO,
    "story": LATEST_PRO,
    "dialogue": LATEST_FLASH,
    "review": LATEST_PRO,
}

# Purposes that run with thinking enabled (§11.2)
THINKING_PURPOSES = {"story", "review", "vision_deep"}

ACCEPTED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".avif"}


class AppConfig(BaseModel):
    gcp_project: str = Field(default_factory=lambda: os.environ.get("GCP_PROJECT", ""))
    gcp_location: str = Field(default_factory=lambda: os.environ.get("GCP_LOCATION", "asia-south1"))
    gcp_fallback_location: str = "us-central1"
    workspace: Path = Field(default_factory=lambda: Path(os.environ.get("WORKSPACE", "./workspace")).resolve())
    db_name: str = Field(default_factory=lambda: os.environ.get("LOCALISER_DB", "chitrakatha.db"))
    max_concurrency: int = Field(default_factory=lambda: int(os.environ.get("LOCALISER_MAX_CONCURRENCY", "6")))
    assets_dir: Path = Field(default_factory=lambda: Path(__file__).resolve().parent.parent / "assets")

    @property
    def db_path(self) -> Path:
        return self.workspace / self.db_name

    @property
    def input_dir(self) -> Path:
        return self.workspace / "input"

    @property
    def projects_dir(self) -> Path:
        return self.workspace / "projects"

    @property
    def output_dir(self) -> Path:
        return self.workspace / "output"

    def ensure_dirs(self) -> None:
        for p in (self.workspace, self.input_dir, self.projects_dir, self.output_dir):
            p.mkdir(parents=True, exist_ok=True)


class StoryConfig(BaseModel):
    min_words: int = 2000
    target_words: int = 2600
    max_words: int = 4200


class CleanConfig(BaseModel):
    allow_lama: bool = False  # Tier 5 shipped disabled (§7.4)
    include_sfx: bool = False  # §7.5
    max_tier: int = 3
    risk_abort: float = 0.85


class FontsConfig(BaseModel):
    dialogue: str = "Mukta-SemiBold"
    thought: str = "Kalam-Regular"
    narration: str = "Mukta-Regular"
    shout: str = "Mukta-ExtraBold"
    sfx: str = "YatraOne-Regular"


class SeriesConfig(BaseModel):
    """Persisted as projects/<slug>/series.json."""

    id: str
    title: str
    title_hi: str | None = None
    input_path: str
    reading_dir: Literal["ltr", "rtl"] = "ltr"
    format: Literal["page", "longstrip"] = "page"
    name_policy: Literal["transliterate", "indianize"] = "transliterate"
    register_default: str = "urban_hinglish"
    rights_status: Literal["owned", "licensed", "internal_test"] = "internal_test"
    story: StoryConfig = StoryConfig()
    clean: CleanConfig = CleanConfig()
    fonts: FontsConfig = FontsConfig()
    models: dict[str, str] = Field(default_factory=lambda: dict(DEFAULT_MODELS))

    def save(self, projects_dir: Path) -> None:
        d = projects_dir / self.id
        d.mkdir(parents=True, exist_ok=True)
        (d / "series.json").write_text(self.model_dump_json(indent=2), encoding="utf-8")

    @classmethod
    def load(cls, projects_dir: Path, series_id: str) -> "SeriesConfig":
        return cls.model_validate_json((projects_dir / series_id / "series.json").read_text(encoding="utf-8"))


def slugify(title: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", title.strip().lower()).strip("-")
    return s or "series"


def project_dir(cfg: AppConfig, series_id: str) -> Path:
    return cfg.projects_dir / series_id


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def dump_json(path: Path, data) -> None:
    """Atomic write (tmp + rename) — edge case #23."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


CFG = AppConfig()
