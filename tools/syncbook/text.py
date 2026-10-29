"""Деление текста блока на предложения и слова."""
import re
from dataclasses import dataclass

from .normalize import pieces

_L = "0-9A-Za-zÀ-ÿА-Яа-яЁё"
WORD_RE = re.compile(rf"[{_L}]+(?:['’][{_L}]+)*")
_LEAD = re.compile(r"^[\s\"'“”‘’«»—–\-(\[…]*")


@dataclass
class Word:
    start: int
    end: int
    text: str
    pieces: list[str]
    lemma: str
    pos: str


@dataclass
class Sentence:
    start: int
    end: int
    words: list[Word]


def _sentence_spans(doc) -> list[tuple[int, int]]:
    """Предложения spaCy; продолжение прямой речи («…," he said») склеивается с предыдущим."""
    spans: list[tuple[int, int]] = []
    text = doc.text
    for sent in doc.sents:
        start, end = sent.start_char, sent.end_char
        while end > start and text[end - 1].isspace():
            end -= 1
        if end <= start:
            continue
        rest = _LEAD.sub("", text[start:end])
        if spans and rest[:1].islower():
            spans[-1] = (spans[-1][0], end)
        else:
            spans.append((start, end))
    return spans


def _words(text: str, start: int, end: int, doc) -> list[Word]:
    raw = [(m.start(), m.end()) for m in WORD_RE.finditer(text, start, end)]
    merged: list[tuple[int, int]] = []
    for s, e in raw:
        if merged and text[merged[-1][1]:s] == "-":
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    words = []
    for s, e in merged:
        tok = max((t for t in doc if t.idx < e and t.idx + len(t) > s), key=len, default=None)
        words.append(Word(s, e, text[s:e], pieces(text[s:e]),
                          tok.lemma_.lower() if tok is not None else text[s:e].lower(),
                          tok.pos_ if tok is not None else ""))
    return words


def split_en(text: str, nlp) -> list[Sentence]:
    doc = nlp(text)
    return [Sentence(s, e, _words(text, s, e, doc)) for s, e in _sentence_spans(doc)]


def split_ru(text: str, nlp) -> list[tuple[int, int]]:
    return _sentence_spans(nlp(text))
