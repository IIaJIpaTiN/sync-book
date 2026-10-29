from pathlib import Path

from syncbook.dictionary import build, coverage, scan

FIX = Path(__file__).parent / "fixtures" / "kaikki_mini.jsonl"


def test_scan_ru_translations_and_ipa():
    idx = scan(FIX, {"young", "walk", "keep"})
    assert set(idx) == {"young", "walk", "keep"}
    assert idx["young"]["ipa"] == "/jʌŋ/"
    assert idx["young"]["senses"][0] == {"pos": "adj", "tr": ["молодой", "юный"]}
    assert idx["young"]["senses"][1] == {"pos": "noun", "tr": ["детёныш"]}
    assert idx["walk"] == {"ipa": "/wɔːk/", "senses": [{"pos": "verb", "tr": ["идти", "ходить"]}]}


def test_build_index_of_and_names():
    idx = scan(FIX, {"young", "walk", "walked", "burrich"})
    occ = [("walked", "walk", "VERB"), ("young", "young", "ADJ")] + [("Burrich", "burrich", "PROPN")] * 10
    entries, index_of = build(occ, idx)
    assert entries[index_of("walked", "walk")]["lemma"] == "walk"
    assert entries[index_of("Burrich", "burrich")] == {"lemma": "Burrich", "name": True}
    assert index_of("zzz", "zzz") == -1
    assert "zebra" not in [e["lemma"] for e in entries]


def test_coverage():
    idx = scan(FIX, {"young"})
    occ = [("young", "young", "ADJ"), ("old", "old", "ADJ")]
    _, index_of = build(occ, idx)
    assert coverage(occ, index_of) == 0.5
