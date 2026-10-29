"""Выборочная проверка синхронизации: python spot_check.py <id> [N]

Берёт N случайных предложений из собранной книги, вырезает их аудио по таймингам
(work/<id>/spot/NN.m4a), распознаёт каждую вырезку Whisper small и сравнивает с текстом.
"""
import json
import random
import subprocess
import sys
import zipfile
from pathlib import Path

from syncbook import cuda_dlls
from syncbook.align import match_pieces
from syncbook.normalize import pieces
from syncbook.tools import ffbin

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    book_id = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    z = zipfile.ZipFile(ROOT / "output" / f"{book_id}.syncbook")
    manifest = json.loads(z.read("manifest.json"))
    out = ROOT / "work" / book_id / "spot"
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(7)
    picks = []
    chapters = [c for c in manifest["chapters"] if c["audio"]]
    while len(picks) < n:
        ch = rng.choice(chapters)
        text = json.loads(z.read(ch["text"]))
        sents = [(b["text"][s["range"][0]:s["range"][1]], s) for b in text["blocks"] for s in b["sentences"]
                 if len(s["words"]) >= 6]
        picks.append((ch, *rng.choice(sents)))

    cuda_dlls.setup()
    from faster_whisper import WhisperModel

    model = WhisperModel("small", device="cuda", compute_type="float16")
    ok = 0
    for i, (ch, sentence, s) in enumerate(picks, start=1):
        src = out / f"src-{ch['id']}.m4a"
        if not src.exists():
            src.write_bytes(z.read(ch["audio"]))
        clip = out / f"{i:02d}.m4a"
        a, b = s["t"][0] - 60, s["t"][1] + 120
        subprocess.run([ffbin("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{max(a, 0) / 1000:.3f}",
                        "-to", f"{b / 1000:.3f}", "-i", str(src), "-c", "copy", str(clip)], check=True)
        segs, _ = model.transcribe(str(clip), language="en", word_timestamps=False)
        heard = " ".join(seg.text for seg in segs)
        book = [p for w in sentence.split() for p in pieces(w)]
        asr = [p for w in heard.split() for p in pieces(w)]
        m = match_pieces(book, asr)
        ratio = sum(x >= 0 for x in m) / max(len(book), 1)
        edges = m[0] >= 0 and m[-1] >= 0
        ok += ratio >= 0.9 and edges
        print(f"{i:02d} гл.{ch['id']} {ratio * 100:5.1f}% края {'да ' if edges else 'НЕТ'} | {sentence[:70]}")
        if ratio < 0.9 or not edges:
            print(f"     услышано: {heard.strip()[:110]}")
    print(f"\nПрошло: {ok} из {len(picks)}. Вырезки: {out}")


if __name__ == "__main__":
    main()
