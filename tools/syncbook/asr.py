"""Распознавание аудиокниги faster-whisper с пословными таймингами."""
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .epub import EpubChapter
from .text import WORD_RE


@dataclass
class AsrWord:
    text: str
    start: int
    end: int
    prob: float


def transcribe(wav: Path, out_jsonl: Path, prompt: str,
               progress: Callable[[float], None] | None = None) -> None:
    from . import cuda_dlls

    cuda_dlls.setup()
    from faster_whisper import WhisperModel

    model = WhisperModel("large-v3", device="cuda", compute_type="float16")
    segments, info = model.transcribe(
        str(wav), language="en", word_timestamps=True, vad_filter=True,
        condition_on_previous_text=False, beam_size=5, initial_prompt=prompt or None)
    tmp = out_jsonl.with_suffix(".part")
    with tmp.open("w", encoding="utf-8") as f:
        for seg in segments:
            for w in seg.words or []:
                f.write(json.dumps({"w": w.word.strip(), "s": round(w.start * 1000),
                                    "e": round(w.end * 1000), "p": round(w.probability, 3)},
                                   ensure_ascii=False) + "\n")
            f.flush()
            if progress:
                progress(seg.end / info.duration)
        f.write('{"done": true}\n')
    tmp.replace(out_jsonl)


def load(out_jsonl: Path) -> list[AsrWord]:
    words, done = [], False
    with out_jsonl.open(encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            if d.get("done"):
                done = True
            else:
                words.append(AsrWord(d["w"], d["s"], d["e"], d["p"]))
    if not done:
        raise ValueError(f"{out_jsonl}: распознавание не завершено")
    return words


_SENT_END = re.compile(r"[.!?…\"“”'‘’:—\-(]\s*$")


def names_prompt(chapters: list[EpubChapter], limit: int = 60) -> str:
    """Частые слова с заглавной буквы в середине предложения — подсказка Whisper об именах."""
    counts: Counter[str] = Counter()
    for ch in chapters:
        for b in ch.blocks:
            for m in WORD_RE.finditer(b.text):
                w = m.group()
                if not w[0].isupper() or w.isupper() or "'" in w or "’" in w:
                    continue
                before = b.text[:m.start()]
                if before.strip() and not _SENT_END.search(before):
                    counts[w] += 1
    names = sorted((w for w, n in counts.items() if n >= 5), key=lambda w: (-counts[w], w))
    return ", ".join(names[:limit])
