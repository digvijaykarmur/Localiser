from pathlib import Path

import numpy as np
from PIL import Image

from localiser.ingest import chapter_number, natural_key, slugify


def test_natural_page_order():
    names = ["10.png", "2.png", "001.png"]
    assert sorted(names, key=natural_key) == ["001.png", "2.png", "10.png"]


def test_decimal_chapter_number():
    assert chapter_number("Chapter 10.5 - Bonus", 1) == 10.5
    assert chapter_number("07 extra", 1) == 7
    assert chapter_number("prologue", 3) == 3


def test_slugify():
    assert slugify("Estate Developer!") == "estate-developer"
