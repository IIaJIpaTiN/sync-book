import pytest


@pytest.fixture(scope="session")
def nlp():
    import spacy

    return spacy.load("en_core_web_sm")


@pytest.fixture(scope="session")
def nlp_ru():
    import spacy

    return spacy.load("ru_core_news_sm")


def _xhtml(body: str) -> str:
    return ('<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml">'
            f"<head><title/></head><body>{body}</body></html>")


def make_epub(tmp_path, files: dict, toc: list, lang: str = "en", title: str = "Test Book",
              author: str = "Tester"):
    """Минимальный EPUB 2: spine в порядке files, toc.ncx из пар (заголовок, файл)."""
    import zipfile

    path = tmp_path / f"book-{lang}.epub"
    items = "".join(f'<item id="f{i}" href="{n}" media-type="application/xhtml+xml"/>'
                    for i, n in enumerate(files))
    spine = "".join(f'<itemref idref="f{i}"/>' for i in range(len(files)))
    opf = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0">'
           '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
           f"<dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:language>{lang}</dc:language>"
           f'</metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>{items}'
           f'</manifest><spine toc="ncx">{spine}</spine></package>')
    nav = "".join(f'<navPoint id="n{i}" playOrder="{i}"><navLabel><text>{t}</text></navLabel>'
                  f'<content src="{src}"/></navPoint>' for i, (t, src) in enumerate(toc))
    ncx = f'<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>{nav}</navMap></ncx>'
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml",
                   '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
                   '<rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>'
                   "</rootfiles></container>")
        z.writestr("OPS/content.opf", opf)
        z.writestr("OPS/toc.ncx", ncx)
        for name, body in files.items():
            z.writestr(f"OPS/{name}", _xhtml(body))
    return path


def words(n: int) -> list[str]:
    """Детерминированные псевдослова без повторяющихся n-грамм."""
    return [f"w{i}" for i in range(n)]
