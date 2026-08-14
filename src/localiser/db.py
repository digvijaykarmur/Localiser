from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Series(Base):
    __tablename__ = "series"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    title_hi: Mapped[str | None] = mapped_column(String)
    input_path: Mapped[str] = mapped_column(Text, nullable=False)
    reading_dir: Mapped[str] = mapped_column(String, nullable=False)
    format: Mapped[str] = mapped_column(String, nullable=False)
    rights_status: Mapped[str] = mapped_column(String, default="internal_test")
    bible_version: Mapped[int] = mapped_column(Integer, default=0)
    bible_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )


class Chapter(Base):
    __tablename__ = "chapters"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    series_id: Mapped[str] = mapped_column(ForeignKey("series.id"))
    number: Mapped[float] = mapped_column(Float, nullable=False)
    title_src: Mapped[str | None] = mapped_column(String)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    state: Mapped[str] = mapped_column(String, default="new")
    story_words: Mapped[int] = mapped_column(Integer, default=0)
    series: Mapped[Series] = relationship(back_populates="chapters")
    pages: Mapped[list["Page"]] = relationship(
        back_populates="chapter", cascade="all, delete-orphan"
    )


class Page(Base):
    __tablename__ = "pages"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"))
    index_in_ch: Mapped[int] = mapped_column(Integer, nullable=False)
    src_filename: Mapped[str] = mapped_column(Text, nullable=False)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    state: Mapped[str] = mapped_column(String, default="new")
    version: Mapped[int] = mapped_column(Integer, default=0)
    duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    skip_processing: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text)
    chapter: Mapped[Chapter] = relationship(back_populates="pages")


def make_engine():
    return create_engine(
        get_settings().database_url,
        connect_args={"check_same_thread": False},
    )


engine = make_engine()
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def session_scope():
    return SessionLocal()
