"""Нормализация слов для сопоставления текста книги с распознанной речью."""
import re
import unicodedata

from num2words import num2words

_SPLIT = re.compile(r"[\s\-‐‑‒–—―/]+")
_EDGE = re.compile(r"^[^\w']+|[^\w']+$")
_ORDINAL = re.compile(r"^(\d+)(st|nd|rd|th)$")


def _numbers(part: str) -> list[str]:
    if part.isdigit():
        words = num2words(int(part))
    elif m := _ORDINAL.match(part):
        words = num2words(int(m.group(1)), to="ordinal")
    else:
        return [part]
    return [w for w in re.split(r"[\s\-,]+", words) if w]


def pieces(token: str) -> list[str]:
    """Слово → список нормализованных кусочков (нижний регистр, без пунктуации)."""
    s = unicodedata.normalize("NFKC", token).lower().replace("’", "'").replace("‘", "'")
    out: list[str] = []
    for part in _SPLIT.split(s):
        part = _EDGE.sub("", part).strip("'")
        if part:
            out.extend(_numbers(part))
    return out
