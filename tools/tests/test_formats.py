import zipfile

from syncbook.epub import Block
from syncbook.formats import chapter_ru, chapter_text, manifest
from syncbook.config import BookConfig
from syncbook.pack import write
from syncbook.text import split_en


def test_chapter_text_schema(nlp):
    d = chapter_text([Block("p", "Hi there.", [])], [split_en("Hi there.", nlp)],
                     [(1000, 1200, False), (1200, 1500, True)], [[(0, 1, 940, 1620)]], [3, -1], 1000)
    s = d["blocks"][0]["sentences"][0]
    assert s == {"id": 0, "range": [0, 9], "t": [0, 500],
                 "words": [[0, 2, 0, 200, 3], [3, 8, 200, 500, -1, 1]], "chunks": [[0, 1, 0, 620]]}


def test_chapter_text_ids_italic_and_sep(nlp):
    blocks = [Block("h", "One", []), Block("sep", "*", []), Block("p", "Go now. Run fast.", [(0, 2)])]
    sents = [split_en(b.text, nlp) if b.kind != "sep" else [] for b in blocks]
    times = [(i * 100, i * 100 + 90, False) for i in range(5)]
    chunks = [[(0, 0, 0, 90)], [(0, 1, 100, 290)], [(0, 1, 300, 490)]]
    d = chapter_text(blocks, sents, times, chunks, [-1] * 5, 0)
    assert [b["kind"] for b in d["blocks"]] == ["h", "sep", "p"]
    assert d["blocks"][1] == {"kind": "sep", "text": "*", "sentences": []}
    assert d["blocks"][2]["italic"] == [[0, 2]]
    assert [s["id"] for b in d["blocks"] for s in b["sentences"]] == [0, 1, 2]
    assert d["blocks"][2]["sentences"][1]["words"][0][:4] == [8, 11, 300, 390]


def test_chapter_ru():
    d = chapter_ru([Block("p", "Привет. Пока.", [])], [[(0, 7), (8, 13)]], [([0], [0, 1])])
    assert d == {"blocks": [{"kind": "p", "text": "Привет. Пока.",
                             "sentences": [{"id": 0, "range": [0, 7]}, {"id": 1, "range": [8, 13]}]}],
                 "align": [[[0], [0, 1]]]}


def test_manifest():
    cfg = BookConfig("b", "Book", "Книга", "Au", "Na", "en.epub", "ru.epub", ["a.m4b"])
    m = manifest(cfg, [{"id": "01"}])
    assert m == {"format": 1, "id": "b", "title": "Book", "titleRu": "Книга", "author": "Au",
                 "narrator": "Na", "cover": "cover.jpg", "dict": "dict.json", "chapters": [{"id": "01"}]}


def test_zip_store(tmp_path):
    write(tmp_path / "b.syncbook", [("audio/01.m4a", b"x" * 10), ("manifest.json", b"{}")])
    z = zipfile.ZipFile(tmp_path / "b.syncbook")
    assert z.namelist()[0] == "manifest.json"
    assert all(i.compress_type == zipfile.ZIP_STORED for i in z.infolist())
    assert z.read("audio/01.m4a") == b"x" * 10
    assert not (tmp_path / "b.part").exists()
