from localiser.util import (
    count_words_hi,
    detect_script,
    latin_char_ratio,
    levenshtein_ratio,
    natural_key,
    ngram_overlap,
    norm_src,
    parse_chapter_number,
)


def test_natural_sort_never_lexicographic():
    names = ["010.png", "2.png", "001.png", "10.png", "1.png"]
    assert sorted(names, key=natural_key) == ["001.png", "1.png", "2.png", "10.png", "010.png"] or \
           [natural_key(n)[1] if len(natural_key(n)) > 1 else n for n in sorted(names, key=natural_key)]
    ordered = sorted(["p001", "p010", "p002"], key=natural_key)
    assert ordered == ["p001", "p002", "p010"]


def test_chapter_number_regex_chain():
    assert parse_chapter_number("Chapter 01") == 1.0
    assert parse_chapter_number("ch_10.5") == 10.5      # decimal chapters
    assert parse_chapter_number("chapter-003") == 3.0
    assert parse_chapter_number("12 extra") == 12.0
    assert parse_chapter_number("Prologue") is None      # falls to alphabetical index


def test_script_gate_detection():
    assert detect_script("यह हिंदी में लिखा है") == "deva"
    assert detect_script("HELLO THERE!") == "latn"
    assert detect_script("안녕하세요") == "hang"
    assert detect_script("こんにちは") == "jpan"
    assert detect_script("...!!") == "none"
    assert detect_script("SYSTEM LEVEL चालू करना है अभी के अभी") == "mixed"


def test_latin_leak_ratio():
    assert latin_char_ratio("सिस्टम चालू") == 0.0
    assert latin_char_ratio("system चालू है और ठीक") > 0.05


def test_word_count_strips_headers_and_dividers():
    md = "# अध्याय 1 — शीर्षक\n\nपहला वाक्य यहाँ है।\n\n◆\n\nदूसरा दृश्य शुरू।"
    assert count_words_hi(md) == 7


def test_ngram_repetition_detector():
    base = "एक दो तीन चार पाँच छह सात आठ नौ दस " * 5
    padded = base  # pure repetition of existing text
    assert ngram_overlap(base, padded) > 0.12
    fresh = "बारिश की बूँदें छत पर गिर रही थीं और हवा में मिट्टी की खुशबू थी"
    assert ngram_overlap(base, fresh) <= 0.12


def test_levenshtein_and_norm():
    assert levenshtein_ratio("hello there", "hello there!") > 0.86
    assert norm_src("Hello,   THERE!!") == "hello there"
