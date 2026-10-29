"""Синтетическая мини-книга для разработки приложения: python -m syncbook.fixture out.syncbook"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from .chunks import pad, split_sentence
from .config import BookConfig
from .epub import Block
from .formats import chapter_ru, chapter_text, manifest
from .pack import write
from .text import split_en, split_ru
from .tools import ffbin

WORD_MS = 350

CHAPTERS = [
    ("The Lantern", "Фонарь", [
        "The lantern hung by the stable door, and its light was the colour of old honey.",
        "Every evening the boy lit it before the horses were fed. He liked the small sound the wick made, "
        "a soft cough, as if the flame had been asleep and was not yet ready to wake.",
        "Nobody had told him to do it. He simply did it, and after a while it became his.",
    ], [
        "Фонарь висел у двери конюшни, и его свет был цвета старого мёда.",
        "Каждый вечер мальчик зажигал его, прежде чем кормили лошадей. Ему нравился тихий звук фитиля, "
        "мягкий кашель, будто пламя спало и ещё не было готово проснуться.",
        "Никто не велел ему этого делать. Он просто делал это, и со временем это стало его делом.",
    ]),
    ("The Road", "Дорога", [
        "In spring the road dried out and the carts came back.",
        "They brought salt and cloth and news, and they took away wool and dried fish.",
        "The boy counted them from the wall, one cart for every year he could remember.",
    ], [
        "Весной дорога просохла, и телеги вернулись.",
        "Они привозили соль, ткань и новости, а увозили шерсть и сушёную рыбу.",
        "Мальчик считал их со стены, по одной телеге на каждый год, который он помнил.",
    ]),
]

DICT = {
    "lantern": ("/ˈlæntən/", "noun", ["фонарь"]),
    "stable": ("/ˈsteɪbəl/", "noun", ["конюшня", "стойло"]),
    "honey": ("/ˈhʌni/", "noun", ["мёд"]),
    "boy": ("/bɔɪ/", "noun", ["мальчик", "парень"]),
    "horse": ("/hɔːs/", "noun", ["лошадь", "конь"]),
    "wick": ("/wɪk/", "noun", ["фитиль"]),
    "flame": ("/fleɪm/", "noun", ["пламя"]),
    "road": ("/rəʊd/", "noun", ["дорога"]),
    "cart": ("/kɑːt/", "noun", ["телега", "повозка"]),
    "wool": ("/wʊl/", "noun", ["шерсть"]),
}


def build(out: Path) -> None:
    import spacy

    nlp, nlp_ru = spacy.load("en_core_web_sm"), spacy.load("ru_core_news_sm")
    keys = list(DICT)
    entries_dict = [{"lemma": k, "ipa": DICT[k][0], "senses": [{"pos": DICT[k][1], "tr": DICT[k][2]}]} for k in keys]
    files: list[tuple[str, Path | bytes]] = []
    chapters_meta = []
    with tempfile.TemporaryDirectory() as tmp:
        tmpd = Path(tmp)
        for n, (title, title_ru, en_pars, ru_pars) in enumerate(CHAPTERS, start=1):
            cid = f"{n:02d}"
            blocks = [Block("h", title, [])] + [Block("p", p, []) for p in en_pars]
            sents = [split_en(b.text, nlp) for b in blocks]
            times, chunks, dict_idx, t = [], [], [], 500
            for block, bs in zip(blocks, sents):
                for s in bs:
                    first = len(times)
                    for w in s.words:
                        times.append((t, t + WORD_MS - 40, False))
                        dict_idx.append(keys.index(w.lemma) if w.lemma in keys else -1)
                        t += WORD_MS
                    seps = [block.text[a.end:b.start] for a, b in zip(s.words, s.words[1:])]
                    parts = split_sentence([w.text for w in s.words], seps, [40] * len(seps))
                    local = [(a, b) for a, b in parts]
                    padded = pad([(first + a, first + b) for a, b in local], [x[:2] for x in times])
                    chunks.append([(f - first, l - first, a, b) for f, l, a, b in padded])
                    t += 400
            duration = t + 500
            ru_blocks = [Block("h", title_ru, [])] + [Block("p", p, []) for p in ru_pars]
            ru_sents = [split_ru(b.text, nlp_ru) for b in ru_blocks]
            n_en = sum(len(bs) for bs in sents)
            n_ru = sum(len(bs) for bs in ru_sents)
            groups = [([i], [i]) for i in range(min(n_en, n_ru))]
            groups += [([i], []) for i in range(n_ru, n_en)] + [([], [j]) for j in range(n_en, n_ru)]
            audio = tmpd / f"{cid}.m4a"
            subprocess.run([ffbin("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                            "-i", f"sine=frequency={220 * n}:sample_rate=44100:duration={duration / 1000}",
                            "-ac", "1", "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", str(audio)],
                           check=True)
            files += [(f"text/{cid}.json", _json(chapter_text(blocks, sents, times, chunks, dict_idx, 0))),
                      (f"ru/{cid}.json", _json(chapter_ru(ru_blocks, ru_sents, groups))),
                      (f"audio/{cid}.m4a", audio)]
            chapters_meta.append({"id": cid, "title": title, "titleRu": title_ru, "kind": "chapter",
                                  "text": f"text/{cid}.json", "ru": f"ru/{cid}.json",
                                  "audio": f"audio/{cid}.m4a", "durationMs": duration})
        cover = tmpd / "cover.jpg"
        subprocess.run([ffbin("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                        "-i", "color=c=0x2F4B7C:s=400x600", "-frames:v", "1", str(cover)], check=True)
        cfg = BookConfig("mini-book", "The Lantern Keeper", "Хранитель фонаря", "SyncBook", "Sine Wave",
                         "", "", [])
        files += [("manifest.json", _json(manifest(cfg, chapters_meta))),
                  ("dict.json", _json({"entries": entries_dict})), ("cover.jpg", cover)]
        write(out, files)


def _json(d: dict) -> bytes:
    return json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


if __name__ == "__main__":
    build(Path(sys.argv[1]))
    print(sys.argv[1])
