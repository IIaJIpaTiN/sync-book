"""Распознавание аудиокниги faster-whisper с пословными таймингами."""
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .epub import EpubChapter
from .text import WORD_RE

WINDOW_MS = 20 * 60 * 1000
OVERLAP_MS = 10_000


@dataclass
class AsrWord:
    text: str
    start: int
    end: int
    prob: float


def windows(total_ms: int, size_ms: int = WINDOW_MS, overlap_ms: int = OVERLAP_MS) -> list[tuple[int, int, int, int]]:
    """Окна (read_from, read_to, keep_from, keep_to): слово берётся из окна, если начинается в [keep_from, keep_to)."""
    out, k = [], 0
    while k < total_ms:
        keep_to = min(k + size_ms, total_ms)
        out.append((max(0, k - overlap_ms), min(keep_to + overlap_ms, total_ms), k, keep_to))
        k = keep_to
    return out


def _pcm16(wav: Path):
    """int16-отсчёты из WAV (mono 16 кГц) без чтения файла в память."""
    import numpy as np

    with wav.open("rb") as f:
        head = f.read(1 << 16)
    pos = 12
    while pos + 8 <= len(head):
        cid, size = head[pos:pos + 4], int.from_bytes(head[pos + 4:pos + 8], "little")
        if cid == b"data":
            return np.memmap(wav, dtype=np.int16, mode="r", offset=pos + 8)
        pos += 8 + size + (size & 1)
    raise ValueError(f"{wav}: не найден блок data")


def _completed(out_jsonl: Path) -> set[int]:
    """Оставляет в файле только завершённые окна и возвращает их номера."""
    if not out_jsonl.exists():
        out_jsonl.write_text("", encoding="utf-8")
        return set()
    lines = [l for l in out_jsonl.read_text(encoding="utf-8").splitlines() if l]
    last = max((i for i, l in enumerate(lines) if '"win"' in l), default=-1)
    kept = lines[:last + 1]
    out_jsonl.write_text("".join(l + "\n" for l in kept), encoding="utf-8")
    return {json.loads(l)["win"] for l in kept if '"win"' in l}


def transcribe(wav: Path, out_jsonl: Path, prompt: str,
               progress: Callable[[float], None] | None = None) -> None:
    """Распознаёт 16 кГц mono wav окнами; при перезапуске продолжает с первого незавершённого окна."""
    import numpy as np

    from . import cuda_dlls

    cuda_dlls.setup()
    from faster_whisper import WhisperModel

    pcm = _pcm16(wav)
    total_ms = len(pcm) * 1000 // 16000
    done = _completed(out_jsonl)
    model = WhisperModel("large-v3", device="cuda", compute_type="float16")
    with out_jsonl.open("a", encoding="utf-8") as f:
        for k, (r0, r1, keep0, keep1) in enumerate(windows(total_ms)):
            if k in done:
                continue
            audio = pcm[r0 * 16:r1 * 16].astype(np.float32) / 32768.0
            segments, _ = model.transcribe(
                audio, language="en", word_timestamps=True, vad_filter=True,
                condition_on_previous_text=False, beam_size=5, initial_prompt=prompt or None)
            for seg in segments:
                for w in seg.words or []:
                    s, e = r0 + round(w.start * 1000), r0 + round(w.end * 1000)
                    if keep0 <= s < keep1:
                        f.write(json.dumps({"w": w.word.strip(), "s": s, "e": e, "p": round(w.probability, 3)},
                                           ensure_ascii=False) + "\n")
                if progress:
                    progress((r0 + seg.end * 1000) / total_ms)
            f.write(json.dumps({"win": k}) + "\n")
            f.flush()
        f.write('{"done": true}\n')


def is_done(out_jsonl: Path) -> bool:
    if not out_jsonl.exists():
        return False
    with out_jsonl.open("rb") as f:
        f.seek(max(0, out_jsonl.stat().st_size - 64))
        return b'"done"' in f.read()


def load(out_jsonl: Path) -> list[AsrWord]:
    words, done = [], False
    with out_jsonl.open(encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            if d.get("done"):
                done = True
            elif "win" not in d:
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
