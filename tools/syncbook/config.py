"""book.toml: описание исходников книги; создаётся автоматически, правится вручную."""
import re
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path

import tomli_w

from . import audio
from .epub import read_epub

AUDIO_EXT = {".m4b", ".m4a", ".mp3"}


@dataclass
class BookConfig:
    id: str
    title: str
    title_ru: str
    author: str
    narrator: str
    en_epub: str
    ru_epub: str
    audio: list[str]
    ru_chapter_map: dict[int, list[int]] | None = None


def slug(title: str) -> str:
    s = re.sub(r"['’]", "", title.lower())
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _detect(book_dir: Path) -> BookConfig:
    books = {}
    for f in sorted(book_dir.glob("*.epub")):
        b = read_epub(f)
        books.setdefault(b.language[:2].lower(), (f.name, b))
    if "en" not in books or "ru" not in books:
        raise ValueError(f"{book_dir}: нужны EPUB на английском и русском (dc:language en и ru)")
    audio_files = sorted(p for p in book_dir.iterdir() if p.suffix.lower() in AUDIO_EXT)
    if not audio_files:
        raise ValueError(f"{book_dir}: не найдено аудио ({', '.join(sorted(AUDIO_EXT))})")
    m = re.search(r"\(([^()]+)\)\s*$", audio_files[0].stem)
    tags = audio.probe(audio_files)["tags"]
    narrator = m.group(1) if m else tags.get("composer") or tags.get("narrator") or tags.get("artist", "")
    en_name, en = books["en"]
    ru_name, ru = books["ru"]
    return BookConfig(slug(en.title), en.title, ru.title, en.author, narrator, en_name, ru_name,
                      [p.name for p in audio_files])


def load_or_create(book_dir: Path) -> BookConfig:
    path = book_dir / "book.toml"
    if not path.exists():
        cfg = _detect(book_dir)
        data = {k: v for k, v in asdict(cfg).items() if v is not None}
        path.write_text("# Описание книги для SyncBook; можно править вручную\n" + tomli_w.dumps(data),
                        encoding="utf-8")
        return cfg
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    cmap = data.get("ru_chapter_map")
    data["ru_chapter_map"] = {int(k): list(v) for k, v in cmap.items()} if cmap else None
    return BookConfig(**data)
