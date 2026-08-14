"""Unit tests that do not need Vertex."""

from __future__ import annotations

import numpy as np
from PIL import Image

from localiser.pipeline.clean import BudgetViolation, verify_change_budget
from localiser.pipeline.detect_cv import detect_bubbles_cv, iou_box
from localiser.pipeline.consistency import apply_glossary, register_violations
from localiser.util import count_words_hi, detect_script, natural_key, parse_chapter_number


def test_natural_key_order():
    names = ["010.png", "2.png", "001.png"]
    assert sorted(names, key=natural_key) == ["001.png", "2.png", "010.png"]


def test_parse_chapter_number():
    assert parse_chapter_number("Chapter 01", 1) == 1.0
    assert parse_chapter_number("ch_10.5", 1) == 10.5
    assert parse_chapter_number("03 - Arc", 9) == 3.0


def test_detect_script_deva_gate():
    assert detect_script("यह एक परीक्षण है") == "deva"
    assert detect_script("Hello world") == "latn"


def test_count_words_hi():
    md = "# शीर्षक\n\nएक दो तीन\n\n◆\n\nचार पाँच"
    assert count_words_hi(md) == 5


def test_budget_assertion(tmp_path):
    page = tmp_path
    (page / "masks").mkdir()
    img = Image.new("RGBA", (20, 20), (10, 20, 30, 255))
    img.save(page / "original.png")
    comp = img.copy()
    px = comp.load()
    px[5, 5] = (255, 0, 0, 255)
    comp.save(page / "composite.png")
    # budget only covers (5,5)
    budget = Image.new("L", (20, 20), 0)
    b = budget.load()
    b[5, 5] = 255
    budget.save(page / "masks" / "budget.png")
    verify_change_budget(page)  # should pass

    # change outside budget
    px[8, 8] = (0, 255, 0, 255)
    comp.save(page / "composite.png")
    try:
        verify_change_budget(page)
        assert False, "expected BudgetViolation"
    except BudgetViolation:
        pass


def test_glossary_and_register():
    text = apply_glossary("Start the Quest now", [{"src": "Quest", "hi": "क्वेस्ट"}])
    assert "क्वेस्ट" in text
    v = register_violations("परन्तु यह अच्छा है", {"avoid": []}, "urban_hinglish_high")
    assert any(x[0] == "too_formal" for x in v)


def test_iou():
    assert iou_box((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert iou_box((0, 0, 10, 10), (20, 20, 5, 5)) == 0.0


def test_cv_detector_on_synthetic():
    # white bubble with black text-like noise
    img = np.full((400, 300, 3), 30, dtype=np.uint8)
    cv2 = __import__("cv2")
    cv2.rectangle(img, (50, 50), (250, 180), (250, 250, 250), -1)
    cv2.putText(img, "HELLO", (70, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2)
    cands = detect_bubbles_cv(img)
    assert isinstance(cands, list)
