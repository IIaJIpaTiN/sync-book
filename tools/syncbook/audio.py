"""Обёртки над ffprobe/ffmpeg."""
import json
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .tools import ffbin


def _run(args: list[str]) -> str:
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"{Path(args[0]).name} завершился с ошибкой:\n{r.stderr[-2000:]}")
    return r.stdout


def probe(paths: list[Path]) -> dict:
    """Суммарная длительность, метки глав (со сдвигом между файлами) и теги первого файла."""
    total, chapters, tags = 0, [], {}
    for i, p in enumerate(paths):
        d = json.loads(_run([ffbin("ffprobe"), "-v", "error", "-show_format", "-show_chapters",
                             "-of", "json", str(p)]))
        if i == 0:
            tags = {k.lower(): v for k, v in d["format"].get("tags", {}).items()}
        for c in d.get("chapters", []):
            chapters.append({"title": c.get("tags", {}).get("title", ""),
                             "start_ms": total + round(float(c["start_time"]) * 1000),
                             "end_ms": total + round(float(c["end_time"]) * 1000)})
        total += round(float(d["format"]["duration"]) * 1000)
    return {"duration_ms": total, "chapters": chapters, "tags": tags}


def _input_args(paths: list[Path], tmpdir: str) -> list[str]:
    if len(paths) == 1:
        return ["-i", str(paths[0])]
    lst = Path(tmpdir) / "inputs.txt"
    lst.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in paths), encoding="utf-8")
    return ["-f", "concat", "-safe", "0", "-i", str(lst)]


def to_wav16k(paths: list[Path], out: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        _run([ffbin("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", *_input_args(paths, tmp),
              "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(out)])


def encode_aac(paths: list[Path], start_ms: int, end_ms: int, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        _run([ffbin("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
              "-ss", f"{start_ms / 1000:.3f}", "-to", f"{end_ms / 1000:.3f}", *_input_args(paths, tmp),
              "-map", "0:a:0", "-map_chapters", "-1", "-map_metadata", "-1",
              "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "48k",
              "-movflags", "+faststart", str(out)])


def encode_chapters(paths: list[Path], cuts: list[tuple[int, int]], out_dir: Path, workers: int = 4) -> list[int]:
    """Кодирует отрезки в out_dir/NN.m4a параллельно; возвращает фактические длительности, мс."""
    outs = [out_dir / f"{i + 1:02d}.m4a" for i in range(len(cuts))]
    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(lambda a: encode_aac(paths, a[0][0], a[0][1], a[1]), zip(cuts, outs)))
    return [probe([o])["duration_ms"] for o in outs]
