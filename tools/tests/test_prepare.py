import json

import pytest

from syncbook.asr import AsrWord, load, names_prompt
from syncbook.epub import Block, EpubChapter


def test_asr_roundtrip(tmp_path):
    words = [AsrWord("Hello", 0, 300, 0.9), AsrWord("there,", 300, 650, 0.8), AsrWord("Fitz.", 700, 1000, 0.95)]
    p = tmp_path / "asr.jsonl"
    p.write_text("".join(json.dumps({"w": w.text, "s": w.start, "e": w.end, "p": w.prob}) + "\n" for w in words)
                 + '{"done": true}\n', encoding="utf-8")
    assert load(p) == words


def test_asr_incomplete_rejected(tmp_path):
    p = tmp_path / "asr.jsonl"
    p.write_text('{"w": "a", "s": 0, "e": 1, "p": 1.0}\n', encoding="utf-8")
    with pytest.raises(ValueError):
        load(p)


def test_names_prompt():
    text = " ".join(["The dog saw Burrich and Chade. I saw Chade’s cat, and I’d go."] * 6 + ["Verity came."] * 2)
    ch = EpubChapter("x", "chapter", [Block("p", text)], [])
    assert names_prompt([ch]) == "Burrich, Chade"


def test_windows_cover_audio_once():
    from syncbook.asr import windows

    w = windows(2_500_000, size_ms=1_000_000, overlap_ms=10_000)
    assert w == [(0, 1_010_000, 0, 1_000_000), (990_000, 2_010_000, 1_000_000, 2_000_000),
                 (1_990_000, 2_500_000, 2_000_000, 2_500_000)]


def test_load_ignores_window_markers(tmp_path):
    p = tmp_path / "asr.jsonl"
    p.write_text('{"w": "a", "s": 0, "e": 1, "p": 1.0}\n{"win": 0}\n{"done": true}\n', encoding="utf-8")
    assert load(p) == [AsrWord("a", 0, 1, 1.0)]
