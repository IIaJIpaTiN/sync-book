from conftest import make_epub
from syncbook.epub import read_epub


def test_chapters_grouping(tmp_path):
    p = make_epub(tmp_path, {"a.xhtml": "<p>Front</p>", "c1.xhtml": "<h1>1 One</h1><p>A</p>",
                             "c1b.xhtml": "<p>B</p>", "c2.xhtml": "<p>C</p>"},
                  toc=[("1 One", "c1.xhtml"), ("2 Two", "c2.xhtml")])
    b = read_epub(p)
    assert [(c.kind, c.title) for c in b.chapters] == [("front", ""), ("chapter", "One"), ("chapter", "Two")]
    assert [x.text for x in b.chapters[1].blocks] == ["1 One", "A", "B"]
    assert (b.title, b.author, b.language) == ("Test Book", "Tester", "en")


def test_italic_nested_br_nbsp(tmp_path):
    p = make_epub(tmp_path, {"c.xhtml": "<p>He <i>said <b>no</b></i>,<br/>then left.</p><p>  </p>"},
                  toc=[("Ch", "c.xhtml")])
    blk = read_epub(p).chapters[0].blocks
    assert len(blk) == 1 and blk[0].text == "He said no, then left."
    assert blk[0].italic == [(3, 10)]


def test_title_div_paragraphs_are_headings(tmp_path):
    p = make_epub(tmp_path, {"c.xhtml": '<span><div class="title"><p>2</p><p>Newboy</p></div>'
                                        '<p class="subtitle">*</p><p>Text.</p></span>'},
                  toc=[("2 Newboy", "c.xhtml#id2")])
    blk = read_epub(p).chapters[0].blocks
    assert [(b.kind, b.text) for b in blk] == [("h", "2"), ("h", "Newboy"), ("sep", "*"), ("p", "Text.")]


def test_back_matter(tmp_path):
    p = make_epub(tmp_path, {"c.xhtml": "<p>A</p>", "z.xhtml": "<p>Bio</p>"},
                  toc=[("1 One", "c.xhtml"), ("About the Author", "z.xhtml")])
    assert [c.kind for c in read_epub(p).chapters] == ["chapter", "back"]
