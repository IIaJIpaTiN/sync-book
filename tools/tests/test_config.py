from conftest import make_epub
from syncbook import audio
from syncbook.config import load_or_create


def _book_dir(tmp_path, monkeypatch, tags=None):
    d = tmp_path / "book"
    d.mkdir()
    make_epub(d, {"c.xhtml": "<p>A</p>"}, [("1 One", "c.xhtml")], lang="en", title="Assassin's Apprentice",
              author="Robin Hobb")
    make_epub(d, {"c.xhtml": "<p>А</p>"}, [("1 Один", "c.xhtml")], lang="ru", title="Ученик убийцы")
    (d / "x (Paul Boehmer).m4b").write_bytes(b"")
    monkeypatch.setattr(audio, "probe", lambda paths: {"duration_ms": 1000, "chapters": [], "tags": tags or {}})
    return d


def test_autodetect(tmp_path, monkeypatch):
    cfg = load_or_create(_book_dir(tmp_path, monkeypatch))
    assert cfg.id == "assassins-apprentice"
    assert (cfg.title, cfg.title_ru, cfg.author) == ("Assassin's Apprentice", "Ученик убийцы", "Robin Hobb")
    assert cfg.en_epub == "book-en.epub" and cfg.ru_epub == "book-ru.epub"
    assert cfg.audio == ["x (Paul Boehmer).m4b"] and cfg.narrator == "Paul Boehmer"
    assert cfg.ru_chapter_map is None


def test_manual_edits_kept(tmp_path, monkeypatch):
    d = _book_dir(tmp_path, monkeypatch)
    load_or_create(d)
    toml = (d / "book.toml").read_text(encoding="utf-8").replace('narrator = "Paul Boehmer"', 'narrator = "P. B."')
    (d / "book.toml").write_text(toml + '\n[ru_chapter_map]\n0 = [1, 2]\n', encoding="utf-8")
    cfg = load_or_create(d)
    assert cfg.narrator == "P. B." and cfg.ru_chapter_map == {0: [1, 2]}


def test_narrator_from_tags(tmp_path, monkeypatch):
    d = _book_dir(tmp_path, monkeypatch, tags={"composer": "Jane Reader"})
    (d / "x (Paul Boehmer).m4b").rename(d / "book.m4b")
    assert load_or_create(d).narrator == "Jane Reader"


def test_chapter_kinds_override(tmp_path, monkeypatch):
    d = _book_dir(tmp_path, monkeypatch)
    load_or_create(d)
    (d / "book.toml").write_text((d / "book.toml").read_text(encoding="utf-8")
                                 + '\n[chapter_kinds]\n3 = "back"\n', encoding="utf-8")
    assert load_or_create(d).chapter_kinds == {3: "back"}


def test_save_chapter_map(tmp_path, monkeypatch):
    from syncbook.config import save_chapter_map

    d = _book_dir(tmp_path, monkeypatch)
    load_or_create(d)
    save_chapter_map(d, {0: [0], 1: [1, 2]})
    assert load_or_create(d).ru_chapter_map == {0: [0], 1: [1, 2]}
