"""Сборка JSON-файлов пакета .syncbook (формат 1, спека §4.9)."""
from .config import BookConfig
from .epub import Block
from .text import Sentence

FORMAT = 1


def chapter_text(blocks: list[Block], sents: list[list[Sentence]], times: list[tuple[int, int, bool]],
                 chunks: list[list[tuple[int, int, int, int]]], dict_idx: list[int], offset_ms: int) -> dict:
    """times/dict_idx — плоские по всем словам главы; chunks — по предложениям, индексы слов локальные."""
    def ms(t: int) -> int:
        return max(t - offset_ms, 0)

    out_blocks = []
    w = 0  # глобальный индекс слова
    sid = 0
    k = 0  # индекс предложения в chunks
    for block, block_sents in zip(blocks, sents):
        ob: dict = {"kind": block.kind, "text": block.text}
        if block.italic:
            ob["italic"] = [list(r) for r in block.italic]
        ob["sentences"] = []
        for s in block_sents:
            words = []
            for word in s.words:
                start, end, interp = times[w]
                item = [word.start, word.end, ms(start), ms(end), dict_idx[w]]
                if interp:
                    item.append(1)
                words.append(item)
                w += 1
            sent_chunks = chunks[k]
            k += 1
            if not words:
                continue
            ob["sentences"].append({
                "id": sid,
                "range": [s.start, s.end],
                "t": [words[0][2], words[-1][3]],
                "words": words,
                "chunks": [[f, l, ms(a), ms(b)] for f, l, a, b in sent_chunks],
            })
            sid += 1
        out_blocks.append(ob)
    return {"blocks": out_blocks}


def chapter_ru(blocks: list[Block], sents: list[list[tuple[int, int]]],
               groups: list[tuple[list[int], list[int]]]) -> dict:
    out_blocks, sid = [], 0
    for block, block_sents in zip(blocks, sents):
        ob = {"kind": block.kind, "text": block.text, "sentences": []}
        for a, b in block_sents:
            ob["sentences"].append({"id": sid, "range": [a, b]})
            sid += 1
        out_blocks.append(ob)
    return {"blocks": out_blocks, "align": [[list(e), list(r)] for e, r in groups]}


def manifest(cfg: BookConfig, chapters: list[dict]) -> dict:
    return {"format": FORMAT, "id": cfg.id, "title": cfg.title, "titleRu": cfg.title_ru,
            "author": cfg.author, "narrator": cfg.narrator, "cover": "cover.jpg", "dict": "dict.json",
            "chapters": chapters}
