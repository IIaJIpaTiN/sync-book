"""Сопоставление слов книги с распознанной речью и вычисление таймингов."""
import bisect
import difflib
from collections import Counter

from rapidfuzz.distance import Levenshtein

MS_PER_CHAR = 65
_LEVELS = (5, 3)
_MAX_DIFF = 25_000_000  # предел len(a)*len(b) для difflib в промежутке без якорей


def _lis(pairs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Наибольшая строго возрастающая по j подпоследовательность пар, отсортированных по i."""
    tails: list[int] = []
    tail_idx: list[int] = []
    prev = [-1] * len(pairs)
    for k, (_, j) in enumerate(pairs):
        pos = bisect.bisect_left(tails, j)
        if pos == len(tails):
            tails.append(j)
            tail_idx.append(k)
        else:
            tails[pos] = j
            tail_idx[pos] = k
        prev[k] = tail_idx[pos - 1] if pos else -1
    out, k = [], tail_idx[-1] if tail_idx else -1
    while k >= 0:
        out.append(pairs[k])
        k = prev[k]
    return out[::-1]


def _anchors(a: list[str], b: list[str], n: int) -> list[tuple[int, int]]:
    ca = Counter(tuple(a[i:i + n]) for i in range(len(a) - n + 1))
    cb = Counter(tuple(b[j:j + n]) for j in range(len(b) - n + 1))
    pos_b = {tuple(b[j:j + n]): j for j in range(len(b) - n + 1) if cb[tuple(b[j:j + n])] == 1}
    pairs = [(i, pos_b[g]) for i in range(len(a) - n + 1)
             if ca[g := tuple(a[i:i + n])] == 1 and g in pos_b]
    kept: list[tuple[int, int]] = []
    for i, j in _lis(pairs):
        for k in range(n):
            if not kept or (i + k > kept[-1][0] and j + k > kept[-1][1]):
                kept.append((i + k, j + k))
    return kept


def _diff(a: list[str], b: list[str], ao: int, bo: int, out: list[int]) -> None:
    if not a or not b or len(a) * len(b) > _MAX_DIFF:
        return
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                out[ao + i1 + k] = bo + j1 + k
        elif tag == "replace":
            for k in range(min(i2 - i1, j2 - j1)):
                x, y = a[i1 + k], b[j1 + k]
                if len(x) > 4 and Levenshtein.distance(x, y) <= 1:
                    out[ao + i1 + k] = bo + j1 + k


def _match(a: list[str], b: list[str], ao: int, bo: int, out: list[int], level: int) -> None:
    if level >= len(_LEVELS):
        _diff(a, b, ao, bo, out)
        return
    anchors = _anchors(a, b, _LEVELS[level])
    bounds = [(-1, -1), *anchors, (len(a), len(b))]
    for (i0, j0), (i1, j1) in zip(bounds, bounds[1:]):
        if 0 <= i1 < len(a):
            out[ao + i1] = bo + j1
        ga, gb = a[i0 + 1:i1], b[j0 + 1:j1]
        if not ga or not gb:
            continue
        if len(ga) > 5000 or len(gb) > 5000:
            _match(ga, gb, ao + i0 + 1, bo + j0 + 1, out, level + 1)
        else:
            _diff(ga, gb, ao + i0 + 1, bo + j0 + 1, out)


def match_pieces(book: list[str], asr: list[str]) -> list[int]:
    """Для каждого кусочка книги — индекс кусочка ASR или -1; совпадения строго монотонны."""
    out = [-1] * len(book)
    _match(book, asr, 0, 0, out, 0)
    return out


def word_times(words_pieces: list[int], piece_match: list[int], asr_piece_time: list[tuple[int, int]],
               word_chars: list[int]) -> list[tuple[int, int, bool]]:
    """Время каждого слова книги: (start, end, interpolated)."""
    known: list[tuple[int, int] | None] = []
    p = 0
    for n in words_pieces:
        hits = [asr_piece_time[j] for j in piece_match[p:p + n] if j >= 0]
        known.append((hits[0][0], hits[-1][1]) if hits else None)
        p += n
    res: list[tuple[int, int, bool] | None] = [(k[0], k[1], False) if k else None for k in known]
    i = 0
    while i < len(res):
        if res[i] is not None:
            i += 1
            continue
        j = i
        while j < len(res) and res[j] is None:
            j += 1
        chars = word_chars[i:j]
        if i > 0 and j < len(res):
            lo, hi = res[i - 1][1], res[j][0]
        elif j < len(res):
            hi = res[j][0]
            lo = hi - MS_PER_CHAR * sum(chars)
        elif i > 0:
            lo = res[i - 1][1]
            hi = lo + MS_PER_CHAR * sum(chars)
        else:
            lo, hi = 0, MS_PER_CHAR * sum(chars)
        hi = max(hi, lo)
        total = sum(chars) or 1
        acc = 0
        for k in range(i, j):
            a = lo + (hi - lo) * acc // total
            acc += word_chars[k]
            res[k] = (a, lo + (hi - lo) * acc // total, True)
        i = j
    out: list[tuple[int, int, bool]] = []
    prev_end = 0
    for s, e, interp in res:
        s = max(s, prev_end, 0)
        e = max(e, s)
        out.append((s, e, interp))
        prev_end = e
    return out


def chapter_cuts(first_starts: list[int], last_ends: list[int], total_ms: int) -> list[tuple[int, int]]:
    starts = [first_starts[0] - min(first_starts[0], 1000)]
    for k in range(1, len(first_starts)):
        starts.append(first_starts[k] - (first_starts[k] - last_ends[k - 1]) // 2)
    end = last_ends[-1] + min(total_ms - last_ends[-1], 1500)
    return list(zip(starts, starts[1:] + [end]))


def stats(interpolated: list[bool]) -> tuple[float, int]:
    if not interpolated:
        return 1.0, 0
    run = best = 0
    for f in interpolated:
        run = run + 1 if f else 0
        best = max(best, run)
    return 1 - sum(interpolated) / len(interpolated), best
