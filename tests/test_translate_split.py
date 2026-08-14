"""§8.5 — utterance splitting across connected bubbles."""
from localiser.pipeline.translate import split_utterance


def test_single_bubble_returns_whole():
    assert split_utterance("नमस्ते दुनिया।", [1.0]) == ["नमस्ते दुनिया।"]


def test_split_prefers_danda_boundary():
    text = "पहला वाक्य यहाँ है। दूसरा वाक्य वहाँ है।"
    parts = split_utterance(text, [0.5, 0.5])
    assert len(parts) == 2
    assert parts[0].endswith("।")
    # never splits inside a word
    for p in parts:
        assert p == p.strip()


def test_split_three_ways_no_word_break():
    text = "एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह"
    parts = split_utterance(text, [0.34, 0.33, 0.33])
    assert len(parts) == 3
    assert " ".join(parts).split() == text.split()
