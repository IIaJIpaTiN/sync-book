"""Проверка окружения конвейера: python check_env.py"""
import subprocess
import sys


def check(name, fn):
    try:
        print(f"OK    {name}: {fn()}")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL  {name}: {e}")


def gpu():
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA недоступна")
    return torch.cuda.get_device_name(0)


def ff(name):
    from syncbook.tools import ffbin

    out = subprocess.run([ffbin(name), "-version"], capture_output=True, text=True).stdout
    return out.splitlines()[0]


def spacy_model(name):
    import spacy

    spacy.load(name)
    return "loaded"


def whisper():
    from syncbook import cuda_dlls

    cuda_dlls.setup()
    from faster_whisper import WhisperModel

    WhisperModel("tiny", device="cuda", compute_type="float16")
    return "tiny on cuda"


check("python", lambda: sys.version.split()[0])
check("gpu", gpu)
check("ffmpeg", lambda: ff("ffmpeg"))
check("ffprobe", lambda: ff("ffprobe"))
check("spacy en", lambda: spacy_model("en_core_web_sm"))
check("spacy ru", lambda: spacy_model("ru_core_news_sm"))
check("whisper", whisper)
