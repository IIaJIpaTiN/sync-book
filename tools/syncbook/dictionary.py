"""Словарь по лексике книги из машиночитаемого Wiktionary (kaikki.org, CC BY-SA)."""
import json
import re
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Callable

KAIKKI_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"
MAX_POS = 3
MAX_TR = 5
_WORD = re.compile(r'"word": "([^"\\]*)"')


def ensure_kaikki(dest: Path) -> Path:
    """Скачивает файл один раз, с докачкой по Range."""
    if dest.exists() and dest.with_suffix(".ok").exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    have = dest.stat().st_size if dest.exists() else 0
    req = urllib.request.Request(KAIKKI_URL, headers={"Range": f"bytes={have}-"} if have else {})
    with urllib.request.urlopen(req) as r, dest.open("ab" if have else "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    dest.with_suffix(".ok").write_text("ok")
    return dest


def _ipa(sounds: list[dict]) -> str | None:
    ipas = [s for s in sounds if s.get("ipa")]
    for pref in (("UK", "Received-Pronunciation"), ("US", "General-American")):
        for s in ipas:
            if any(t in pref for t in s.get("tags", [])):
                return s["ipa"]
    return ipas[0]["ipa"] if ipas else None


def scan(jsonl: Path, wanted: set[str]) -> dict[str, dict]:
    """Потоковый проход по kaikki: для слов из wanted — IPA и русские переводы по частям речи."""
    ipa: dict[str, str | None] = {}
    senses: dict[str, dict[str, list[str]]] = defaultdict(dict)
    with jsonl.open(encoding="utf-8") as f:
        for line in f:
            if not any(w.lower() in wanted for w in _WORD.findall(line)):
                continue
            d = json.loads(line)
            word = d.get("word", "").lower()
            if word not in wanted:
                continue
            trs = list(d.get("translations", []))
            for s in d.get("senses", []):
                trs.extend(s.get("translations", []))
            ru = [t["word"].replace("́", "") for t in trs if t.get("code") == "ru" and t.get("word")]
            if word not in ipa or ipa[word] is None:
                ipa[word] = _ipa(d.get("sounds", []))
            if not ru:
                continue
            bucket = senses[word].setdefault(d.get("pos", ""), [])
            for t in ru:
                if t not in bucket and len(bucket) < MAX_TR:
                    bucket.append(t)
    return {w: {"ipa": ipa.get(w), "senses": [{"pos": p, "tr": tr} for p, tr in list(s.items())[:MAX_POS]]}
            for w, s in senses.items()}


def build(occurrences: list[tuple[str, str, str]], index: dict[str, dict]):
    """Записи словаря и функция index_of(surface, lemma) -> индекс или -1."""
    entries: list[dict] = []
    key_to_idx: dict[str, int] = {}

    def add(key: str, entry: dict) -> None:
        if key not in key_to_idx:
            key_to_idx[key] = len(entries)
            entries.append(entry)

    caps: Counter[str] = Counter()
    total: Counter[str] = Counter()
    propn: set[str] = set()
    for surface, lemma, pos in occurrences:
        low = surface.lower()
        total[low] += 1
        caps[low] += surface[:1].isupper()
        if pos == "PROPN":
            propn.add(low)
        for key in (lemma.lower(), low):
            if key in index:
                add(key, {"lemma": key, **index[key]})
                break
    for surface, lemma, _ in occurrences:
        low = surface.lower()
        if low in propn and low not in key_to_idx and lemma.lower() not in key_to_idx \
                and caps[low] >= 0.9 * total[low]:
            add(low, {"lemma": surface[:1].upper() + surface[1:], "name": True})

    def index_of(surface: str, lemma: str) -> int:
        for key in (lemma.lower(), surface.lower()):
            if key in key_to_idx:
                return key_to_idx[key]
        return -1

    return entries, index_of


def coverage(occurrences: list[tuple[str, str, str]], index_of: Callable[[str, str], int]) -> float:
    seen: dict[str, bool] = {}
    for surface, lemma, _ in occurrences:
        low = surface.lower()
        seen[low] = seen.get(low, False) or index_of(surface, lemma) >= 0
    return sum(seen.values()) / len(seen) if seen else 1.0
