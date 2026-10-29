"""На Windows ctranslate2 ищет cuDNN/cuBLAS в PATH; берём их из колеса torch."""
import os
from pathlib import Path

_done = False


def setup() -> None:
    global _done
    if _done or os.name != "nt":
        return
    import torch

    lib = Path(torch.__file__).parent / "lib"
    os.add_dll_directory(str(lib))
    os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")
    _done = True
