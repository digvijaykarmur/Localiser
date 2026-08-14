"""SQLAlchemy 2.x models — localiser.db schema."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class Series(Base):
    __tablename__ = "series"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    title_hi: Mapped[str | None] = mapped_column(String, nullable=True)
    input_path: Mapped[str] = mapped_column(String, nullable=False)
    reading_dir: Mapped[str] = mapped_column(String, nullable=False, default="ltr")
    format: Mapped[str] = mapped_column(String, nullable=False, default="page")
    bible_version: Mapped[int] = mapped_column(Integer, default=0)
    bible_locked: Mapped[int] = mapped_column(Integer, default=0)
    rights_status: Mapped[str] = mapped_column(String, default="internal_test")
    name_policy: Mapped[str] = mapped_column(String, default="transliterate")
    created_at: Mapped[str | None] = mapped_column(String, default=utcnow)
    updated_at: Mapped[str | None] = mapped_column(String, default=utcnow)

    chapters: Mapped[list[Chapter]] = relationship(back_populates="series")


class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = (UniqueConstraint("series_id", "number"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    series_id: Mapped[str] = mapped_column(ForeignKey("series.id"))
    number: Mapped[float] = mapped_column(Float, nullable=False)  # REAL for 10.5 etc.
    title_src: Mapped[str | None] = mapped_column(String, nullable=True)
    title_hi: Mapped[str | None] = mapped_column(String, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, default=0)
    state: Mapped[str] = mapped_column(String, nullable=False, default="new")
    story_words: Mapped[int] = mapped_column(Integer, default=0)

    series: Mapped[Series] = relationship(back_populates="chapters")
    pages: Mapped[list[Page]] = relationship(back_populates="chapter")


class Page(Base):
    __tablename__ = "pages"
    __table_args__ = (UniqueConstraint("chapter_id", "index_in_ch"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"))
    index_in_ch: Mapped[int] = mapped_column(Integer, nullable=False)
    src_filename: Mapped[str] = mapped_column(String, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False, default="new")
    version: Mapped[int] = mapped_column(Integer, default=0)
    qc_score: Mapped[float | None] = mapped_column(Float)
    flagged: Mapped[int] = mapped_column(Integer, default=0)
    skip_processing: Mapped[int] = mapped_column(Integer, default=0)

    chapter: Mapped[Chapter] = relationship(back_populates="pages")
    regions: Mapped[list[Region]] = relationship(back_populates="page")


class Region(Base):
    __tablename__ = "regions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id"))
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    bbox: Mapped[str] = mapped_column(Text, nullable=False)  # JSON
    polygon: Mapped[str | None] = mapped_column(Text)
    src_text: Mapped[str | None] = mapped_column(Text)
    src_script: Mapped[str | None] = mapped_column(String)
    utterance_id: Mapped[str | None] = mapped_column(String)
    speaker_id: Mapped[str | None] = mapped_column(String)
    speaker_conf: Mapped[float | None] = mapped_column(Float)
    target_text: Mapped[str | None] = mapped_column(Text)
    target_locked: Mapped[int] = mapped_column(Integer, default=0)
    clean_tier: Mapped[int | None] = mapped_column(Integer)
    clean_risk: Mapped[float | None] = mapped_column(Float)
    render_json: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, nullable=False, default="detected")
    confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str | None] = mapped_column(String)

    page: Mapped[Page] = relationship(back_populates="regions")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id"))
    region_id: Mapped[str | None] = mapped_column(String)
    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="open")
    created_at: Mapped[str | None] = mapped_column(String, default=utcnow)
    resolved_at: Mapped[str | None] = mapped_column(String)


class PatchOp(Base):
    __tablename__ = "patch_ops"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    scope: Mapped[str] = mapped_column(String, nullable=False)
    scope_id: Mapped[str] = mapped_column(String, nullable=False)
    op: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    source_ref: Mapped[str | None] = mapped_column(String)
    applied_at: Mapped[str | None] = mapped_column(String)
    reverted_at: Mapped[str | None] = mapped_column(String)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    scope_id: Mapped[str] = mapped_column(String, nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    total: Mapped[int | None] = mapped_column(Integer)
    completed: Mapped[int | None] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[str | None] = mapped_column(String)
    finished_at: Mapped[str | None] = mapped_column(String)


class LlmCall(Base):
    __tablename__ = "llm_calls"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    job_id: Mapped[str | None] = mapped_column(String)
    model: Mapped[str | None] = mapped_column(String)
    purpose: Mapped[str | None] = mapped_column(String)
    in_tokens: Mapped[int | None] = mapped_column(Integer)
    out_tokens: Mapped[int | None] = mapped_column(Integer)
    thinking_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    cache_hit: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str | None] = mapped_column(String, default=utcnow)


class LlmCache(Base):
    __tablename__ = "llm_cache"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    response: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[str | None] = mapped_column(String, default=utcnow)


_engine = None
_SessionLocal = None


def get_engine(db_path: str | None = None):
    global _engine, _SessionLocal
    if _engine is None:
        from localiser.config import get_settings

        path = db_path or str(get_settings().db_path)
        _engine = create_engine(
            f"sqlite:///{path}",
            connect_args={"check_same_thread": False},
        )
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)
    return _engine


def get_session_factory():
    get_engine()
    return _SessionLocal


def init_db(db_path: str | None = None) -> None:
    engine = get_engine(db_path)
    Base.metadata.create_all(engine)


def get_db():
    Session = get_session_factory()
    db = Session()
    try:
        yield db
    finally:
        db.close()
