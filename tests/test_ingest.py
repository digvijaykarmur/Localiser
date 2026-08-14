"""Stage 0 — real folder → chapters/pages in correct natural order."""
import numpy as np
from PIL import Image

from localiser.config import CFG, SeriesConfig
from localiser.db import Chapter, PageRow, session


def _make_input(root, chapters):
    for ch_name, pages in chapters.items():
        d = root / ch_name
        d.mkdir(parents=True)
        rng = np.random.default_rng(42)
        for name in pages:
            arr = rng.integers(0, 255, (120, 80, 3), np.uint8)
            Image.fromarray(arr).save(d / name)


def test_ingest_natural_order_and_dedup(tmp_workspace):
    from localiser.pipeline.ingest import ingest_series

    src = tmp_workspace / "input" / "Test Manga"
    _make_input(src, {
        "Chapter 2": ["10.png", "2.png", "1.png"],
        "Chapter 10.5": ["001.png"],
        "ch_1": ["001.png", "002.jpg"],
    })
    # rejected extension
    (src / "Chapter 2" / "notes.txt").write_text("skip me")

    scfg = SeriesConfig(id="test-manga", title="Test Manga", input_path=str(src))
    report = ingest_series(scfg)

    assert report["chapters"] == 3
    assert report["pages"] == 6
    assert any("notes.txt" in r for r in report["rejected"])

    with session() as s:
        chapters = sorted(s.query(Chapter).all(), key=lambda c: c.number)
        assert [c.number for c in chapters] == [1.0, 2.0, 10.5]   # decimal chapter as REAL

        ch2 = next(c for c in chapters if c.number == 2.0)
        pages = (s.query(PageRow).filter(PageRow.chapter_id == ch2.id)
                 .order_by(PageRow.index_in_ch).all())
        # natural sort: 1, 2, 10 — never lexicographic 1, 10, 2
        assert [p.src_filename for p in pages] == ["1.png", "2.png", "10.png"]

    # originals exist and are immutable copies
    from localiser.pipeline.paths import page_paths

    pp = page_paths("test-manga/ch-001/001")
    assert pp["original"].exists()


def test_ingest_duplicate_detection(tmp_workspace):
    from localiser.pipeline.ingest import ingest_series

    src = tmp_workspace / "input" / "Dup Manga"
    d = src / "Chapter 1"
    d.mkdir(parents=True)
    arr = np.random.default_rng(7).integers(0, 255, (100, 80, 3), np.uint8)
    Image.fromarray(arr).save(d / "001.png")
    Image.fromarray(arr).save(d / "002.png")   # identical pixels

    scfg = SeriesConfig(id="dup-manga", title="Dup Manga", input_path=str(src))
    report = ingest_series(scfg)
    assert len(report["duplicates"]) == 1
    with session() as s:
        dup = s.get(PageRow, "dup-manga/ch-001/002")
        assert dup.skip_processing == 1
