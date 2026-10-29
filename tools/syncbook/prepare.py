"""Конвейер подготовки книги.

python -m syncbook.prepare "books/<книга>" [--force STAGE ...] [--only STAGE]
Промежуточные результаты — в work/<id>/, итог — output/<id>.syncbook и output/<id>.report.html.
"""
import argparse
import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Callable

from . import asr as asr_mod
from . import audio, report
from .align import chapter_cuts, match_pieces, stats, word_times
from .chunks import pad, split_sentence
from .config import BookConfig, load_or_create
from .epub import Block
from .formats import chapter_ru, chapter_text, manifest
from .normalize import pieces
from .pack import write
from .text import Sentence, Word
from .tools import ffbin

ROOT = Path(__file__).resolve().parents[2]
WARN_MATCH = 0.90
WARN_RUN = 40
WARN_RU_QUALITY = 0.6


@dataclass
class Stage:
    name: str
    fn: Callable
    inputs: Callable
    outputs: Callable


def _fresh(stage: Stage, ctx) -> bool:
    outs = stage.outputs(ctx)
    if not outs or not all(p.exists() for p in outs):
        return False
    newest_in = max((p.stat().st_mtime for p in stage.inputs(ctx) if p.exists()), default=0)
    return min(p.stat().st_mtime for p in outs) >= newest_in


def run_stages(stages: list[Stage], ctx, force=frozenset(), only: str | None = None) -> None:
    for st in stages:
        if only and st.name != only:
            continue
        if st.name in force or only == st.name or not _fresh(st, ctx):
            print(f"[{st.name}] выполняется…", flush=True)
            t = time.time()
            st.fn(ctx)
            print(f"[{st.name}] готово за {time.time() - t:.0f} с", flush=True)
        else:
            print(f"[{st.name}] из кэша", flush=True)


class Ctx:
    def __init__(self, book_dir: Path):
        self.book_dir = book_dir
        self.cfg: BookConfig = load_or_create(book_dir)
        self.work = ROOT / "work" / self.cfg.id
        self.work.mkdir(parents=True, exist_ok=True)
        self.out = ROOT / "output"
        self.audio_files = [book_dir / a for a in self.cfg.audio]

    def p(self, name: str) -> Path:
        return self.work / name

    def load(self, name: str):
        return json.loads(self.p(name).read_text(encoding="utf-8"))

    def save(self, name: str, data) -> None:
        tmp = self.p(name + ".part")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.p(name))


# ---------- стадии ----------

def st_extract(ctx: Ctx) -> None:
    import spacy

    from .epub import read_epub
    from .text import split_en, split_ru

    nlp, nlp_ru = spacy.load("en_core_web_sm"), spacy.load("ru_core_news_sm")
    en_book = read_epub(ctx.book_dir / ctx.cfg.en_epub)
    ru_book = read_epub(ctx.book_dir / ctx.cfg.ru_epub)

    def en_block(b: Block) -> dict:
        sents = [] if b.kind == "sep" else split_en(b.text, nlp)
        return {"kind": b.kind, "text": b.text, "italic": b.italic,
                "sents": [{"start": s.start, "end": s.end,
                           "words": [[w.start, w.end, w.text, w.lemma, w.pos] for w in s.words]}
                          for s in sents if s.words]}

    def ru_block(b: Block) -> dict:
        return {"kind": b.kind, "text": b.text, "italic": b.italic,
                "sents": [] if b.kind == "sep" else [list(s) for s in split_ru(b.text, nlp_ru)]}

    for i, kind in (ctx.cfg.chapter_kinds or {}).items():
        if 0 <= i < len(en_book.chapters):
            en_book.chapters[i].kind = kind
    if en_book.cover:
        raw = ctx.p("cover.src")
        raw.write_bytes(en_book.cover)
        subprocess.run([ffbin("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw),
                        "-vf", "scale=-2:min(900\\,ih)", "-q:v", "3", str(ctx.p("cover.jpg"))], check=True)
    en_chapters = []
    for c in en_book.chapters:
        blocks = [en_block(b) for b in c.blocks]
        kind = c.kind
        if kind == "chapter" and not any(b["sents"] for b in blocks):
            kind = "back" if en_chapters else "front"  # без слов нечего читать и синхронизировать
        en_chapters.append({"title": c.title, "kind": kind, "blocks": blocks})
    ctx.save("01_extract.json", {
        "en": en_chapters,
        "ru": [{"title": c.title, "kind": c.kind, "blocks": [ru_block(b) for b in c.blocks]} for c in ru_book.chapters],
    })


def st_audio(ctx: Ctx) -> None:
    audio.to_wav16k(ctx.audio_files, ctx.p("02_audio.wav"))


def st_asr(ctx: Ctx) -> None:
    from .epub import EpubChapter

    ex = ctx.load("01_extract.json")
    chapters = [EpubChapter(c["title"], c["kind"], [Block(b["kind"], b["text"]) for b in c["blocks"]], [])
                for c in ex["en"]]
    log = ctx.p("asr.log").open("w", encoding="utf-8")
    asr_mod.transcribe(ctx.p("02_audio.wav"), ctx.p("03_asr.jsonl"), asr_mod.names_prompt(chapters),
                       lambda f: (log.write(f"{f:.4f}\n"), log.flush()))


def _audio_chapters(ex: dict) -> list[int]:
    return [i for i, c in enumerate(ex["en"]) if c["kind"] == "chapter"]


def _iter_words(chapter: dict):
    for b in chapter["blocks"]:
        for s in b["sents"]:
            for w in s["words"]:
                yield b, s, w


def st_align(ctx: Ctx) -> None:
    ex = ctx.load("01_extract.json")
    audio_ch = _audio_chapters(ex)
    book_pieces, words_pieces, word_chars, owner = [], [], [], []
    for ci in audio_ch:
        for _, _, w in _iter_words(ex["en"][ci]):
            ps = pieces(w[2])
            book_pieces += ps
            words_pieces.append(len(ps))
            word_chars.append(len(w[2]))
            owner.append(ci)
    asr_pieces, asr_time = [], []
    for aw in asr_mod.load(ctx.p("03_asr.jsonl")):
        for p in pieces(aw.text):
            asr_pieces.append(p)
            asr_time.append((aw.start, aw.end))
    match = match_pieces(book_pieces, asr_pieces)
    times = word_times(words_pieces, match, asr_time, word_chars)
    by_ch: dict[int, list] = {ci: [] for ci in audio_ch}
    for ci, t in zip(owner, times):
        by_ch[ci].append(t)
    total = audio.probe(ctx.audio_files)["duration_ms"]
    cuts = chapter_cuts([by_ch[ci][0][0] for ci in audio_ch], [by_ch[ci][-1][1] for ci in audio_ch], total)
    out = {}
    for ci, cut in zip(audio_ch, cuts):
        flags = [t[2] for t in by_ch[ci]]
        ratio, run = stats(flags)
        out[str(ci)] = {"times": [list(t) for t in by_ch[ci]], "cut": list(cut), "match": ratio, "run": run,
                        "warnings": _runs(ex["en"][ci], by_ch[ci], cut[0])}
    ctx.save("04_align.json", out)


def _runs(chapter: dict, times: list, offset: int) -> list[dict]:
    """Серии > WARN_RUN интерполированных слов: время (от начала главы) и контекст."""
    words = [w[2] for _, _, w in _iter_words(chapter)]
    out, i = [], 0
    while i < len(times):
        if times[i][2]:
            j = i
            while j < len(times) and times[j][2]:
                j += 1
            if j - i > WARN_RUN:
                out.append({"ms": times[i][0] - offset, "context": " ".join(words[i:i + 20]), "len": j - i})
            i = j
        else:
            i += 1
    return out


def st_chunks(ctx: Ctx) -> None:
    ex, al = ctx.load("01_extract.json"), ctx.load("04_align.json")
    out = {}
    for ci in _audio_chapters(ex):
        times = [(t[0], t[1]) for t in al[str(ci)]["times"]]
        res, w0 = [], 0
        for b in ex["en"][ci]["blocks"]:
            for s in b["sents"]:
                ws = s["words"]
                n = len(ws)
                seps = [b["text"][ws[k][1]:ws[k + 1][0]] for k in range(n - 1)]
                gaps = [times[w0 + k + 1][0] - times[w0 + k][1] for k in range(n - 1)]
                parts = split_sentence([w[2] for w in ws], seps, gaps)
                padded = pad([(w0 + a, w0 + c) for a, c in parts], times)
                res.append([[f - w0, l - w0, a, c] for f, l, a, c in padded])
                w0 += n
        out[str(ci)] = res
    ctx.save("05_chunks.json", out)


def st_encode(ctx: Ctx) -> None:
    ex, al = ctx.load("01_extract.json"), ctx.load("04_align.json")
    cuts = [tuple(al[str(ci)]["cut"]) for ci in _audio_chapters(ex)]
    durations = audio.encode_chapters(ctx.audio_files, cuts, ctx.p("06_audio"))
    ctx.save("06_audio.json", durations)


def st_bilingual(ctx: Ctx) -> None:
    from .bilingual import (ChapterMapError, Embedder, align_sentences, chapter_match, default_chapter_map,
                            group_quality, split_shared, suspicious)
    from .config import save_chapter_map

    ex = ctx.load("01_extract.json")
    en = [c for c in ex["en"] if c["kind"] == "chapter"]
    ru = [c for c in ex["ru"] if c["kind"] == "chapter"]
    manual = ctx.cfg.ru_chapter_map is not None
    cmap = ctx.cfg.ru_chapter_map or default_chapter_map(
        [SimpleNamespace(kind="chapter")] * len(en), [SimpleNamespace(kind="chapter")] * len(ru))
    bad_idx = [k for k, rs in cmap.items() if not 0 <= k < len(en) or any(not 0 <= r < len(ru) for r in rs)]
    if bad_idx:
        raise ChapterMapError(f"ru_chapter_map в book.toml ссылается на несуществующие главы: {bad_idx} "
                              f"(EN: {len(en)} глав, RU: {len(ru)} глав, нумерация с 0)")
    emb = Embedder()

    def opening(c: dict) -> list[str]:
        return [b["text"][:600] for b in c["blocks"] if b["kind"] == "p" and b["sents"]][:3] or [c["title"]]

    sims = chapter_match([emb.encode(opening(c)) for c in en],
                         [emb.encode([b["text"][:600] for b in c["blocks"] if b["kind"] == "p"]) for c in ru], cmap)
    bad = suspicious(sims)
    if bad and not manual:
        names = ", ".join(f"{k} «{en[k]['title']}»" for k in bad)
        raise ChapterMapError(f"Начала EN-глав {names} не найдены в сопоставленных RU-главах — проверьте "
                              "соответствие и задайте ru_chapter_map в book.toml")
    if not manual:
        save_chapter_map(ctx.book_dir, cmap)
    shared: dict[tuple, list[int]] = {}
    for k in sorted(cmap):
        shared.setdefault(tuple(cmap[k]), []).append(k)
    out = {}
    for ru_ids, ks in shared.items():
        en_texts, counts = [], []
        for k in ks:
            texts = [b["text"][s["start"]:s["end"]] for b in en[k]["blocks"] for s in b["sents"]]
            en_texts += texts
            counts.append(len(texts))
        ru_blocks = [b for r in ru_ids for b in ru[r]["blocks"]]
        ru_texts, ru_block = [], []
        for bi, b in enumerate(ru_blocks):
            for a, c in b["sents"]:
                ru_texts.append(b["text"][a:c])
                ru_block.append(bi)
        ev, rv = emb.encode(en_texts), emb.encode(ru_texts)
        groups = align_sentences(ev, rv)
        q = group_quality(groups, ev, rv)
        parts = split_shared(groups, counts, ru_block) if len(ks) > 1 else [(groups, (0, len(ru_blocks)), 0)]
        for k, (g, (b0, b1), _) in zip(ks, parts):
            out[str(k)] = {"ru": list(ru_ids), "blocks": [b0, b1], "groups": g, "quality": q,
                           "map_sim": sims[k], "map_suspicious": k in bad}
    ctx.save("07_bilingual.json", out)


def st_dict(ctx: Ctx) -> None:
    from .dictionary import build, coverage, ensure_kaikki, scan

    ex = ctx.load("01_extract.json")
    occ = [(w[2], w[3], w[4]) for c in ex["en"] for _, _, w in _iter_words(c)]
    wanted = {o[1].lower() for o in occ} | {o[0].lower() for o in occ}
    index = scan(ensure_kaikki(ROOT / "work" / "_shared" / "kaikki-en.jsonl"), wanted)
    entries, index_of = build(occ, index)
    idx = {str(ci): [index_of(w[2], w[3]) for _, _, w in _iter_words(c)] for ci, c in enumerate(ex["en"])}
    ctx.save("08_dict.json", {"entries": entries, "idx": idx, "coverage": coverage(occ, index_of)})


def _sentences(block: dict) -> list[Sentence]:
    return [Sentence(s["start"], s["end"], [Word(w[0], w[1], w[2], [], w[3], w[4]) for w in s["words"]])
            for s in block["sents"]]


def _ru_title(t: str) -> str:
    return t.capitalize() if t.isupper() else t


def st_pack(ctx: Ctx) -> None:
    ex, al, ch = ctx.load("01_extract.json"), ctx.load("04_align.json"), ctx.load("05_chunks.json")
    durations, bi, dc = ctx.load("06_audio.json"), ctx.load("07_bilingual.json"), ctx.load("08_dict.json")
    ru = [c for c in ex["ru"] if c["kind"] == "chapter"]
    audio_ch = _audio_chapters(ex)
    files: list[tuple[str, Path | bytes]] = []
    metas, rep_chapters, warnings = [], [], []
    k = -1
    for ci, c in enumerate(ex["en"]):
        cid = f"{ci + 1:02d}"
        blocks = [Block(b["kind"], b["text"], [tuple(r) for r in b["italic"]]) for b in c["blocks"]]
        sents = [_sentences(b) for b in c["blocks"]]
        n_words = sum(len(s.words) for ss in sents for s in ss)
        n_sents = sum(len(ss) for ss in sents)
        meta = {"id": cid, "title": c["title"], "titleRu": None, "kind": c["kind"], "text": f"text/{cid}.json",
                "ru": None, "audio": None, "durationMs": 0}
        if c["kind"] == "chapter":
            k += 1
            a = al[str(ci)]
            times = [tuple(t) for t in a["times"]]
            chunks, offset = ch[str(ci)], a["cut"][0]
            n = audio_ch.index(ci)
            meta["audio"] = f"audio/{cid}.m4a"
            meta["durationMs"] = durations[n]
            files.append((meta["audio"], ctx.p("06_audio") / f"{n + 1:02d}.m4a"))
            b2 = bi.get(str(k))
            if b2:
                ru_blocks_all = [b for r in b2["ru"] for b in ru[r]["blocks"]]
                rb = ru_blocks_all[b2["blocks"][0]:b2["blocks"][1]]
                meta["titleRu"] = _ru_title(ru[b2["ru"][0]]["title"])
                meta["ru"] = f"ru/{cid}.json"
                files.append((meta["ru"], _json(chapter_ru(
                    [Block(b["kind"], b["text"]) for b in rb], [[tuple(s) for s in b["sents"]] for b in rb],
                    [(g[0], g[1]) for g in b2["groups"]]))))
            warn = (a["match"] < WARN_MATCH or a["run"] > WARN_RUN
                    or (b2 is not None and (b2["quality"] < WARN_RU_QUALITY or b2.get("map_suspicious"))))
            if b2 and b2.get("map_suspicious"):
                warnings.append({"chapter": c["title"], "ms": 0,
                                 "context": f"начало главы не найдено в русской главе (сходство {b2['map_sim']:.2f}) — "
                                            "проверьте ru_chapter_map в book.toml"})
            rep_chapters.append({"title": c["title"], "match": a["match"], "run": a["run"],
                                 "ru_quality": b2["quality"] if b2 else None, "duration_ms": durations[n],
                                 "warn": warn})
            warnings += [{"chapter": c["title"], "ms": w["ms"], "context": w["context"]} for w in a["warnings"]]
        else:
            times, chunks, offset = [(0, 0, False)] * n_words, [[] for _ in range(n_sents)], 0
        files.append((meta["text"], _json(chapter_text(blocks, sents, times, chunks, dc["idx"][str(ci)], offset))))
        metas.append(meta)
    files.append(("dict.json", _json({"entries": dc["entries"]})))
    if ctx.p("cover.jpg").exists():
        files.append(("cover.jpg", ctx.p("cover.jpg")))
    files.append(("manifest.json", _json(manifest(ctx.cfg, metas))))
    write(ctx.out / f"{ctx.cfg.id}.syncbook", files)
    report.write(ctx.out / f"{ctx.cfg.id}.report.html", {
        "title": ctx.cfg.title, "chapters": rep_chapters, "warnings": warnings, "dict_coverage": dc["coverage"]})


def _json(d) -> bytes:
    return json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def stages() -> list[Stage]:
    def inputs(*names):
        return lambda ctx: [ctx.p(n) for n in names]

    def out(*names):
        return lambda ctx: [ctx.p(n) for n in names]

    epubs = lambda ctx: [ctx.book_dir / ctx.cfg.en_epub, ctx.book_dir / ctx.cfg.ru_epub]  # noqa: E731
    return [
        Stage("extract", st_extract, epubs, out("01_extract.json")),
        Stage("audio", st_audio, lambda ctx: ctx.audio_files, out("02_audio.wav")),
        Stage("asr", st_asr, inputs("02_audio.wav"),
              lambda ctx: [ctx.p("03_asr.jsonl")] if asr_mod.is_done(ctx.p("03_asr.jsonl")) else []),
        Stage("align", st_align, inputs("01_extract.json", "03_asr.jsonl"), out("04_align.json")),
        Stage("chunks", st_chunks, inputs("01_extract.json", "04_align.json"), out("05_chunks.json")),
        Stage("encode", st_encode, inputs("04_align.json"), out("06_audio.json")),
        Stage("bilingual", st_bilingual,
              lambda ctx: [ctx.p("01_extract.json"), ctx.book_dir / "book.toml"], out("07_bilingual.json")),
        Stage("dict", st_dict, inputs("01_extract.json"), out("08_dict.json")),
        Stage("pack", st_pack,
              inputs("01_extract.json", "04_align.json", "05_chunks.json", "06_audio.json",
                     "07_bilingual.json", "08_dict.json"),
              lambda ctx: [ctx.out / f"{ctx.cfg.id}.syncbook"]),
    ]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book_dir", type=Path)
    ap.add_argument("--force", nargs="*", default=[], help="перезапустить эти стадии")
    ap.add_argument("--only", help="выполнить только эту стадию")
    args = ap.parse_args()
    run_stages(stages(), Ctx(args.book_dir.resolve()), set(args.force), args.only)


if __name__ == "__main__":
    main()
