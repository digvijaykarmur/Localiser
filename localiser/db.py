"""SQLite state store (single file chitrakatha.db) — schema per spec §4.2."""
from __future__ import annotations

import datetime as _dt
from contextlib import contextmanager

from sqlalchemy import (
    Column,
    Float,
    Integer,
    String,
    Text,
    create_engine,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import CFG


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class Series(Base):
    __tablename__ = "series"
    id = Column(String, primary_key=True)            # 'estate-developer'
    title = Column(String, nullable=False)
    title_hi = Column(String)
    input_path = Column(String, nullable=False)
    reading_dir = Column(String, nullable=False)      # 'ltr' | 'rtl'
    format = Column(String, nullable=False)           # 'page' | 'longstrip'
    rights_status = Column(String, default="internal_test")
    bible_version = Column(Integer, default=0)
    bible_locked = Column(Integer, default=0)
    created_at = Column(String, default=now_iso)
    updated_at = Column(String, default=now_iso)


class Chapter(Base):
    __tablename__ = "chapters"
    id = Column(String, primary_key=True)             # 'estate-developer/ch-001'
    series_id = Column(String, nullable=False)
    number = Column(Float, nullable=False)            # REAL — decimal chapters (10.5)
    title_src = Column(String)
    title_hi = Column(String)
    page_count = Column(Integer)
    state = Column(String, nullable=False, default="new")
    story_words = Column(Integer, default=0)
    __table_args__ = (UniqueConstraint("series_id", "number"),)


class PageRow(Base):
    __tablename__ = "pages"
    id = Column(String, primary_key=True)             # 'estate-developer/ch-001/003'
    chapter_id = Column(String, nullable=False)
    index_in_ch = Column(Integer, nullable=False)
    src_filename = Column(String, nullable=False)
    width = Column(Integer)
    height = Column(Integer)
    sha256 = Column(String, nullable=False)
    state = Column(String, nullable=False, default="new")
    flagged = Column(Integer, default=0)
    skip_processing = Column(Integer, default=0)      # duplicates (§Stage 0 step 6)
    version = Column(Integer, default=0)
    qc_score = Column(Float)
    __table_args__ = (UniqueConstraint("chapter_id", "index_in_ch"),)


class Region(Base):
    __tablename__ = "regions"
    id = Column(String, primary_key=True)             # '<page_id>/r03'
    page_id = Column(String, nullable=False)
    ordinal = Column(Integer, nullable=False)
    kind = Column(String, nullable=False)             # dialogue|thought|narration|sfx|sign|ui_window|credit
    bbox = Column(Text, nullable=False)               # JSON [x,y,w,h]
    polygon = Column(Text)                            # JSON [[x,y],...]
    src_text = Column(Text)
    src_script = Column(String)                       # latn|hang|jpan|deva|mixed|none
    utterance_id = Column(String)
    speaker_id = Column(String)
    speaker_conf = Column(Float)
    target_text = Column(Text)
    target_locked = Column(Integer, default=0)
    clean_tier = Column(Integer)
    clean_risk = Column(Float)
    render_json = Column(Text)                        # font, size, leading, box, align
    confidence = Column(Float)
    source = Column(String)                           # both|gemini_only|cv_only
    status = Column(String, nullable=False, default="detected")


class Note(Base):
    __tablename__ = "notes"
    id = Column(String, primary_key=True)
    page_id = Column(String, nullable=False)
    region_id = Column(String)
    x = Column(Float)
    y = Column(Float)
    body = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="open")   # open|applied|rejected
    created_at = Column(String, default=now_iso)
    resolved_at = Column(String)


class PatchOp(Base):
    __tablename__ = "patch_ops"
    id = Column(String, primary_key=True)
    scope = Column(String, nullable=False)             # region|page|chapter|series
    scope_id = Column(String, nullable=False)
    op = Column(String, nullable=False)
    payload = Column(Text, nullable=False)             # JSON, includes `before` snapshot
    source = Column(String, nullable=False)            # chat|note|manual
    source_ref = Column(String)
    applied_at = Column(String)
    reverted_at = Column(String)


class Job(Base):
    __tablename__ = "jobs"
    id = Column(String, primary_key=True)
    kind = Column(String, nullable=False)
    scope_id = Column(String, nullable=False)
    state = Column(String, nullable=False, default="queued")
    progress = Column(Float, default=0)
    total = Column(Integer)
    completed = Column(Integer)
    error = Column(Text)
    started_at = Column(String)
    finished_at = Column(String)


class LlmCall(Base):
    __tablename__ = "llm_calls"
    id = Column(String, primary_key=True)
    job_id = Column(String)
    model = Column(String)
    purpose = Column(String)
    in_tokens = Column(Integer)
    out_tokens = Column(Integer)
    thinking_tokens = Column(Integer)
    latency_ms = Column(Integer)
    cache_hit = Column(Integer)
    created_at = Column(String, default=now_iso)


class LlmCache(Base):
    __tablename__ = "llm_cache"
    key = Column(String, primary_key=True)             # sha256(prompt+model+image_hashes)
    response = Column(Text, nullable=False)
    model = Column(String)
    created_at = Column(String, default=now_iso)


_engine = None
_SessionLocal: sessionmaker | None = None


def init_db(db_path=None):
    global _engine, _SessionLocal
    path = db_path or CFG.db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    _engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(_engine)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


@contextmanager
def session() -> Session:
    global _SessionLocal
    if _SessionLocal is None:
        init_db()
    s = _SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()
