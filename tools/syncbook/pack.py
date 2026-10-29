"""Упаковка .syncbook: ZIP без сжатия, manifest.json первой записью."""
import zipfile
from pathlib import Path


def write(out: Path, entries: list[tuple[str, Path | bytes]]) -> None:
    entries = sorted(entries, key=lambda e: e[0] != "manifest.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as z:
        for name, src in entries:
            if isinstance(src, Path):
                z.write(src, name)
            else:
                z.writestr(name, src)
    tmp.replace(out)
