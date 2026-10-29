"""Сопоставление русского издания с английским: главы, затем группы предложений."""
import numpy as np

from .epub import EpubChapter

STEPS = [(1, 1), (1, 2), (2, 1), (1, 3), (3, 1), (2, 2), (1, 0), (0, 1)]


class ChapterMapError(ValueError):
    pass


class Embedder:
    def __init__(self, model: str = "sentence-transformers/LaBSE"):
        from . import cuda_dlls

        cuda_dlls.setup()
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model, device="cuda")

    def encode(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, 768), dtype=np.float32)
        return self.model.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=False)


def default_chapter_map(en: list[EpubChapter], ru: list[EpubChapter]) -> dict[int, list[int]]:
    """Индексы среди глав kind=chapter: EN k → [RU k]."""
    ne = sum(c.kind == "chapter" for c in en)
    nr = sum(c.kind == "chapter" for c in ru)
    if ne != nr:
        raise ChapterMapError(f"EN: {ne} глав, RU: {nr} глав — задайте ru_chapter_map в book.toml "
                              "(номер EN-главы = [номера RU-глав], нумерация с 0 среди обычных глав)")
    return {k: [k] for k in range(ne)}


MAP_THRESHOLD = 0.45


def chapter_match(en_open: list[np.ndarray], ru_pars: list[np.ndarray], cmap: dict[int, list[int]]) -> dict[int, float]:
    """Для каждой EN-главы — наибольшее сходство её первых абзацев с абзацами сопоставленных RU-глав.

    Максимум по абзацам, а не начало к началу: так находятся EN-главы, слитые в переводе в одну,
    и главы, у которых в переводе пропущен эпиграф.
    """
    out = {}
    for k, rs in cmap.items():
        pars = [ru_pars[r] for r in rs if len(ru_pars[r])]
        out[k] = float(max((p @ en_open[k].T).max() for p in pars)) if pars and len(en_open[k]) else 0.0
    return out


def suspicious(sims: dict[int, float], threshold: float = MAP_THRESHOLD) -> list[int]:
    return sorted(k for k, s in sims.items() if s < threshold)


def _groups(v: np.ndarray, k: int) -> np.ndarray:
    """g[i] = нормированная сумма v[i-k:i] для i >= k (строки 0..k-1 нулевые)."""
    p = np.vstack([np.zeros((1, v.shape[1])), np.cumsum(v, axis=0)])
    g = np.zeros((len(v) + 1, v.shape[1]))
    if len(v) >= k:
        s = p[k:] - p[:-k]
        g[k:] = s / np.maximum(np.linalg.norm(s, axis=1, keepdims=True), 1e-9)
    return g


def align_sentences(en: np.ndarray, ru: np.ndarray, skip: float = -0.1) -> list[tuple[list[int], list[int]]]:
    n, m = len(en), len(ru)
    if n == 0 or m == 0:
        return [([i], []) for i in range(n)] + [([], [j]) for j in range(m)]
    ge = {k: _groups(en, k) for k in (1, 2, 3)}
    gr = {k: _groups(ru, k) for k in (1, 2, 3)}
    sim = {(a, b): ge[a] @ gr[b].T for a, b in STEPS if a and b}
    band = max(40, (max(n, m) + 9) // 10)
    neg = -1e18
    score = np.full((n + 1, m + 1), neg)
    back = np.zeros((n + 1, m + 1), dtype=np.int8)
    score[0, 0] = 0.0
    for i in range(n + 1):
        c = i * m / n
        for j in range(max(0, int(c) - band), min(m, int(c) + band) + 1):
            if i == 0 and j == 0:
                continue
            best, arg = neg, -1
            for s, (a, b) in enumerate(STEPS):
                if a > i or b > j or score[i - a, j - b] == neg:
                    continue
                w = skip if not a or not b else sim[(a, b)][i, j] - 0.05 * (a + b - 2)
                if score[i - a, j - b] + w > best:
                    best, arg = score[i - a, j - b] + w, s
            score[i, j], back[i, j] = best, arg
    out = []
    i, j = n, m
    while i or j:
        a, b = STEPS[back[i, j]]
        out.append((list(range(i - a, i)), list(range(j - b, j))))
        i, j = i - a, j - b
    return out[::-1]


def group_quality(groups, en: np.ndarray, ru: np.ndarray) -> float:
    sims = []
    for e, r in groups:
        if e and r:
            a = en[e].sum(axis=0)
            b = ru[r].sum(axis=0)
            sims.append(float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)))
    return float(np.mean(sims)) if sims else 0.0


def split_shared(groups, en_counts: list[int], ru_block: list[int]):
    """Делит выравнивание одной RU-главы между несколькими EN-главами.

    en_counts — число EN-предложений каждой главы (в порядке склейки); ru_block[s] — номер блока
    RU-предложения s. Для каждой EN-главы возвращает (группы с локальными индексами,
    (первый_блок, конец_блока), индекс первого RU-предложения диапазона).
    """
    bounds = [0]
    for n in en_counts:
        bounds.append(bounds[-1] + n)
    owner, cur = [], 0
    for e, _ in groups:
        if e:
            cur = next(k for k in range(len(en_counts)) if bounds[k] <= e[0] < bounds[k + 1])
        owner.append(cur)
    n_blocks = (max(ru_block) + 1) if ru_block else 0
    starts = [0]
    for k in range(1, len(en_counts)):
        first_ru = next((r[0] for (e, r), o in zip(groups, owner) if o >= k and r), None)
        starts.append(max(starts[-1], ru_block[first_ru] if first_ru is not None else n_blocks))
    starts.append(n_blocks)
    out = []
    for k in range(len(en_counts)):
        b0, b1 = starts[k], starts[k + 1]
        s0 = next((s for s, b in enumerate(ru_block) if b >= b0), len(ru_block))
        local = []
        for (e, r), o in zip(groups, owner):
            if o != k:
                continue
            rr = [x - s0 for x in r if b0 <= ru_block[x] < b1]
            if e or rr:
                local.append(([x - bounds[k] for x in e], rr))
        out.append((local, (b0, b1), s0))
    return out
