"""§4.3 — locked entries can never be mutated by proposals; §4.4 descriptors."""
import numpy as np
from PIL import Image

from localiser.pipeline.bible import (
    descriptor_score,
    enforce_no_locked_mutation,
    face_descriptor,
)


def test_locked_character_mutation_discarded():
    bible = {
        "characters": [{"id": "char_a", "name_hi": "लक्ष्य", "locked": True}],
        "glossary": [{"src": "Quest", "hi": "क्वेस्ट", "locked": True}],
    }
    proposal = {
        "new_characters": [
            {"id": "char_a", "name_hi": "बदला हुआ"},     # mutation attempt → discard
            {"id": "char_b", "name_hi": "नया"},          # legit addition → keep
        ],
        "new_glossary_terms": [
            {"src": "Quest", "hi": "मिशन"},               # locked term → discard
            {"src": "Skill", "hi": "स्किल"},
        ],
    }
    clean = enforce_no_locked_mutation(bible, proposal)
    assert [c["id"] for c in clean["new_characters"]] == ["char_b"]
    assert [g["src"] for g in clean["new_glossary_terms"]] == ["Skill"]


def test_face_descriptor_matches_same_image():
    rng = np.random.default_rng(3)
    img = Image.fromarray(rng.integers(0, 255, (64, 64, 3), np.uint8))
    a = face_descriptor(img)
    b = face_descriptor(img)
    assert descriptor_score(a, b) > 0.95


def test_face_descriptor_distinguishes_different_faces():
    # two structured faces with different texture and different hair colour
    rng1, rng2 = np.random.default_rng(1), np.random.default_rng(2)
    face_a = rng1.integers(0, 255, (64, 64, 3), np.uint8)
    face_a[:21] = [30, 20, 15]        # dark hair (top third)
    face_b = rng2.integers(0, 255, (64, 64, 3), np.uint8)
    face_b[:21] = [220, 200, 90]      # blonde hair
    a = face_descriptor(Image.fromarray(face_a))
    b = face_descriptor(Image.fromarray(face_b))
    assert descriptor_score(a, b) < 0.72
