"""§6 — TM (NN-4), glossary enforcement, name policy (NN-5), register guard."""
from localiser.pipeline.consistency import (
    TM,
    enforce_glossary,
    enforce_names,
    learn_wrong_variant,
    register_violations,
)


def test_tm_exact_hit_reuses_verbatim(tmp_workspace):
    tm = TM("test-series")
    tm.store("I will crush you!", "char_a", "dialogue", "urban", "मैं तुझे कुचल दूँगा!", "r1")
    hit = tm.lookup("I will crush you!", "char_a", "dialogue", "urban")
    assert hit["type"] == "exact"
    assert hit["target_hi"] == "मैं तुझे कुचल दूँगा!"
    tm.close()


def test_tm_same_line_same_speaker_is_deterministic(tmp_workspace):
    """NN-4: same source line + speaker always produces identical Hindi."""
    tm = TM("test-series")
    tm.store("Let's go.", "char_a", "dialogue", "urban", "चल!", "ch1/r1")
    # chapter 3, same line, same speaker → byte-identical
    hit = tm.lookup("let's go", "char_a", "dialogue", "urban")
    assert hit["type"] == "exact" and hit["target_hi"] == "चल!"
    tm.close()


def test_tm_fuzzy_hit_other_speaker(tmp_workspace):
    tm = TM("test-series")
    tm.store("Good morning", "char_a", "dialogue", "urban", "गुड मॉर्निंग", "r1")
    hit = tm.lookup("Good morning", "char_b", "dialogue", "formal")
    assert hit["type"] == "fuzzy"
    tm.close()


def test_tm_user_lock_never_overwritten(tmp_workspace):
    tm = TM("test-series")
    tm.store("Quest done", "char_a", "dialogue", "urban", "यूज़र वाला", "r1", user_locked=True)
    tm.store("Quest done", "char_a", "dialogue", "urban", "मशीन वाला", "r1")
    hit = tm.lookup("Quest done", "char_a", "dialogue", "urban")
    assert hit["target_hi"] == "यूज़र वाला"
    tm.close()


def test_glossary_forced_substitution():
    glossary = [{"src": "Status Window", "hi": "स्टेटस विंडो"},
                {"src": "Quest", "hi": "क्वेस्ट", "known_wrong_hi": ["खोज"]}]
    out = enforce_glossary("The status window shows a quest. एक खोज बाकी है।", glossary)
    assert "स्टेटस विंडो" in out
    assert "क्वेस्ट" in out
    assert "खोज" not in out          # known-wrong drift auto-corrected


def test_glossary_learns_its_own_drift():
    glossary = [{"src": "Mana", "hi": "माना"}]
    learn_wrong_variant(glossary, "Mana", "मन")
    assert "मन" in glossary[0]["known_wrong_hi"]
    assert enforce_glossary("उसका मन खत्म हो गया", glossary) == "उसका माना खत्म हो गया"


def test_name_postpass_transliterates_consistently():
    bible = {"characters": [{"name_src": "Lakshya Rana", "name_hi": "लक्ष्य राणा"}]}
    out = enforce_names("Lakshya said hello. LAKSHYA RANA smiled.", bible)
    assert "Lakshya" not in out
    assert "लक्ष्य राणा" in out


def test_register_guard_catches_formal_words():
    reg = {"id": "urban_hinglish_high", "avoid": ["सुनो, हे मित्र"]}
    v = register_violations("परन्तु यह अत्यंत आवश्यक है", reg)
    kinds = [k for k, _ in v]
    assert "too_formal" in kinds


def test_register_guard_catches_latin_leak():
    reg = {"id": "urban_hinglish_high", "avoid": []}
    v = register_violations("ये system बहुत slow है yaar really", reg)
    assert any(k == "latin_leak" for k, _ in v)


def test_register_guard_catches_casual_in_formal():
    reg = {"id": "formal_polite", "avoid": []}
    v = register_violations("अबे तू क्या कर रहा है", reg)
    assert any(k == "too_casual" for k, _ in v)


def test_register_guard_catches_cjk_punct():
    reg = {"id": "urban_hinglish_high", "avoid": []}
    v = register_violations("ठीक है。", reg)
    assert any(k == "cjk_punct" for k, _ in v)


def test_clean_line_passes():
    reg = {"id": "urban_hinglish_high", "avoid": ["परन्तु"]}
    assert register_violations("अरे यार, ये सिस्टम तो कमाल है!", reg) == []
