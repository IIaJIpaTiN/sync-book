"""Чтение EPUB: порядок spine, главы по toc.ncx, блоки текста с курсивом."""
import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

from lxml import etree

from .text import WORD_RE

NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
    "ncx": "http://www.daisy.org/z3986/2005/ncx/",
}
BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "ul", "ol",
              "section", "article", "table", "tr", "td", "body", "center", "dl", "dd", "dt"}
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
ITALIC_TAGS = {"i", "em"}
SKIP_TAGS = {"head", "script", "style", "img", "svg", "image"}
BACK_RE = re.compile(r"about the author|also by|copyright|acknowledg|об авторе|содержание", re.I)
_PARSER = etree.XMLParser(recover=True, resolve_entities=False)


@dataclass
class Block:
    kind: str  # "h" | "p" | "sep"
    text: str
    italic: list[tuple[int, int]] = field(default_factory=list)


@dataclass
class EpubChapter:
    title: str
    kind: str  # "chapter" | "front" | "back"
    blocks: list[Block]
    src: list[str]


@dataclass
class EpubBook:
    title: str
    author: str
    language: str
    cover: bytes | None
    chapters: list[EpubChapter]


def _local(tag) -> str:
    return etree.QName(tag).localname.lower() if isinstance(tag, str) else ""


def _has_block(el) -> bool:
    return any(_local(d.tag) in BLOCK_TAGS for d in el.iter() if d is not el)


def _finish(buf: list[tuple[str, bool]]) -> tuple[str, list[tuple[int, int]]]:
    """Склеивает сегменты, схлопывает пробелы, вычисляет диапазоны курсива."""
    chars: list[tuple[str, bool]] = []
    for s, ital in buf:
        for ch in s:
            if ch.isspace():
                if chars and chars[-1][0] != " ":
                    chars.append((" ", ital))
            else:
                chars.append((ch, ital))
    while chars and chars[-1][0] == " ":
        chars.pop()
    text = "".join(c for c, _ in chars)
    ranges: list[tuple[int, int]] = []
    i = 0
    while i < len(chars):
        if chars[i][1] and chars[i][0] != " ":
            j = i
            while j < len(chars) and chars[j][1]:
                j += 1
            end = j
            while end > i and chars[end - 1][0] == " ":
                end -= 1
            ranges.append((i, end))
            i = j
        else:
            i += 1
    return text, ranges


def _inline(el, buf: list, ital: bool) -> None:
    tag = _local(el.tag)
    if tag in SKIP_TAGS:
        return
    if tag == "br":
        buf.append((" ", ital))
        return
    ital = ital or tag in ITALIC_TAGS
    if el.text:
        buf.append((el.text, ital))
    for c in el:
        _inline(c, buf, ital)
        if c.tail:
            buf.append((c.tail, ital))


def _is_heading(el) -> bool:
    return _local(el.tag) in HEADING_TAGS or any("title" in c for c in (el.get("class") or "").split())


def _walk(container, heading: bool, blocks: list[Block]) -> None:
    buf: list[tuple[str, bool]] = []

    def flush():
        text, italic = _finish(buf)
        buf.clear()
        if not text:
            return
        kind = ("h" if heading else "p") if WORD_RE.search(text) else "sep"
        blocks.append(Block(kind, text, italic))

    if container.text:
        buf.append((container.text, False))
    for child in container:
        tag = _local(child.tag)
        if tag in SKIP_TAGS:
            pass
        elif tag in BLOCK_TAGS or _has_block(child):
            flush()
            _walk(child, heading or _is_heading(child), blocks)
        else:
            _inline(child, buf, False)
        if child.tail:
            buf.append((child.tail, False))
    flush()


def _blocks(data: bytes) -> list[Block]:
    root = etree.fromstring(data, _PARSER)
    body = next((e for e in root.iter() if _local(e.tag) == "body"), root)
    blocks: list[Block] = []
    _walk(body, False, blocks)
    return blocks


def _resolve(base: str, href: str) -> str:
    return posixpath.normpath(posixpath.join(base, unquote(href.split("#")[0])))


def _clean_title(label: str) -> str:
    t = re.sub(r"^\s*\d+[.:]?\s+", "", label).strip()
    return t or label.strip()


def read_epub(path: Path) -> EpubBook:
    z = zipfile.ZipFile(path)
    container = etree.fromstring(z.read("META-INF/container.xml"), _PARSER)
    opf_path = container.find(".//c:rootfile", NS).get("full-path")
    base = posixpath.dirname(opf_path)
    opf = etree.fromstring(z.read(opf_path), _PARSER)

    def meta(name: str) -> str:
        el = opf.find(f".//dc:{name}", NS)
        return (el.text or "").strip() if el is not None else ""

    manifest = {i.get("id"): i for i in opf.iterfind(".//opf:manifest/opf:item", NS)}
    spine = [_resolve(base, manifest[r.get("idref")].get("href"))
             for r in opf.iterfind(".//opf:spine/opf:itemref", NS) if r.get("idref") in manifest]

    toc: dict[str, str] = {}
    ncx_item = next((i for i in manifest.values() if i.get("media-type") == "application/x-dtbncx+xml"), None)
    if ncx_item is not None:
        ncx_path = _resolve(base, ncx_item.get("href"))
        ncx = etree.fromstring(z.read(ncx_path), _PARSER)
        for np_ in ncx.iterfind(".//ncx:navPoint", NS):
            label = "".join(np_.find("ncx:navLabel/ncx:text", NS).itertext())
            src = _resolve(posixpath.dirname(ncx_path), np_.find("ncx:content", NS).get("src"))
            toc.setdefault(src, label)

    chapters: list[EpubChapter] = []
    for src in spine:
        blocks = _blocks(z.read(src))
        if src in toc:
            label = toc[src]
            kind = "back" if BACK_RE.search(label) else "chapter"
            chapters.append(EpubChapter(_clean_title(label), kind, blocks, [src]))
        elif chapters:
            chapters[-1].blocks.extend(blocks)
            chapters[-1].src.append(src)
        else:
            chapters.append(EpubChapter("", "front", blocks, [src]))
    chapters = [c for c in chapters if c.blocks or c.kind == "chapter"]

    cover = None
    cover_id = next((m.get("content") for m in opf.iterfind(".//opf:meta", NS) if m.get("name") == "cover"), None)
    item = next((i for i in manifest.values() if "cover-image" in (i.get("properties") or "")), None)
    if item is None and cover_id in manifest:
        item = manifest[cover_id]
    if item is None:
        item = next((i for i in manifest.values()
                     if (i.get("media-type") or "").startswith("image/") and "cover" in i.get("href", "").lower()), None)
    if item is not None:
        cover = z.read(_resolve(base, item.get("href")))

    return EpubBook(meta("title"), meta("creator"), meta("language"), cover, chapters)
