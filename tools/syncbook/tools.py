"""Поиск ffmpeg/ffprobe: PATH, затем папка пакетов winget (PATH может быть ещё не обновлён)."""
import os
import shutil
from functools import cache
from pathlib import Path


@cache
def ffbin(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    root = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for exe in root.glob(f"Gyan.FFmpeg*/*/bin/{name}.exe"):
        return str(exe)
    raise FileNotFoundError(f"{name} не найден: установите ffmpeg (winget install Gyan.FFmpeg)")
