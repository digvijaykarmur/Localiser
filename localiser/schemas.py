"""Pydantic schemas for SeriesConfig, Bible, analysis, API payloads."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class StoryConfig(BaseModel):
    min_words: int = 2000
    target_words: int = 2600
    max_words: int = 4200


class FontsConfig(BaseModel):
    dialogue: str = "Mukta-SemiBold"
    thought: str = "Kalam-Regular"
    narration: str = "Mukta-Regular"
    shout: str = "Mukta-ExtraBold"
    sfx: str = "YatraOne-Regular"


class CleanConfig(BaseModel):
    allow_lama: bool = False
    max_tier: int = 3
    risk_abort: float = 0.85
    include_sfx: bool = False


class ModelsConfig(BaseModel):
    """Always latest Gemini IDs — do not pin older generations."""

    vision_bulk: str = "gemini-3.7-flash"
    vision_deep: str = "gemini-3.1-pro-preview"
    story: str = "gemini-3.1-pro-preview"
    dialogue: str = "gemini-3.7-flash"
    review: str = "gemini-3.1-pro-preview"


class SeriesConfig(BaseModel):
    id: str
    title: str
    title_hi: str | None = None
    input_path: str
    reading_dir: Literal["ltr", "rtl"] = "ltr"
    format: Literal["page", "longstrip"] = "page"
    name_policy: Literal["transliterate", "indianize"] = "transliterate"
    register_default: str = "urban_hinglish"
    rights_status: Literal["owned", "licensed", "internal_test"] = "internal_test"
    story: StoryConfig = Field(default_factory=StoryConfig)
    fonts: FontsConfig = Field(default_factory=FontsConfig)
    clean: CleanConfig = Field(default_factory=CleanConfig)
    models: ModelsConfig = Field(default_factory=ModelsConfig)


class RegionAnalysis(BaseModel):
    id: str
    ordinal: int
    kind: str
    bbox: list[int]
    polygon: list[list[int]] | None = None
    interior_color: list[int] | None = None
    mask: str | None = None
    source: str = "gemini_only"
    confidence: float = 0.5
    src_text: str | None = None
    src_script: str | None = None
    utterance_id: str | None = None
    speaker_id: str | None = None
    speaker_conf: float | None = None
    target_text: str | None = None
    status: str = "detected"


class PageAnalysis(BaseModel):
    page_id: str
    size: list[int]
    format: str
    regions: list[RegionAnalysis] = Field(default_factory=list)
    panels: list[dict[str, Any]] = Field(default_factory=list)
    characters: list[dict[str, Any]] = Field(default_factory=list)


class CreateSeriesRequest(BaseModel):
    title: str
    title_hi: str | None = None
    input_path: str
    reading_dir: Literal["ltr", "rtl"] = "ltr"
    format: Literal["page", "longstrip"] | None = None
    name_policy: Literal["transliterate", "indianize"] = "transliterate"
    rights_status: Literal["owned", "licensed", "internal_test"] = "internal_test"


class RunChapterRequest(BaseModel):
    stages: list[str]
    confirm_cost: bool = False


class RegionPatch(BaseModel):
    target_text: str | None = None
    locked: bool | None = None
    speaker_id: str | None = None
    font_px: int | None = None


class NoteCreate(BaseModel):
    page_id: str
    region_id: str | None = None
    x: float | None = None
    y: float | None = None
    body: str


class ChatRequest(BaseModel):
    scope: Literal["region", "page", "chapter", "series"]
    scope_id: str
    message: str
    selected_region_id: str | None = None


class ExportRequest(BaseModel):
    series_id: str
    include_story: bool = True
    include_bible: bool = True
    include_qa: bool = True
    override_blockers: bool = False
    override_phrase: str | None = None


class BiblePreviewRequest(BaseModel):
    character_id: str
    sample_text: str
