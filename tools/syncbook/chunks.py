"""Отрывки для режима «Повтор»: предложение или его части не длиннее max_words."""
CONJUNCTIONS = {"and", "but", "or", "which", "that", "who", "when", "while", "because", "though", "as"}


def _priority(i: int, words: list[str], seps: list[str], gaps: list[int]) -> int:
    sep = seps[i]
    if any(c in sep for c in ";:—–"):
        return 4
    if "," in sep:
        return 3
    if gaps[i] >= 250:
        return 2
    if words[i + 1].lower() in CONJUNCTIONS:
        return 1
    return 0


def split_sentence(words: list[str], seps: list[str], gaps: list[int],
                   max_words: int = 12, min_words: int = 3) -> list[tuple[int, int]]:
    """seps[i]/gaps[i] — текст и пауза между словами i и i+1; диапазоны включительные."""
    def rec(a: int, b: int) -> list[tuple[int, int]]:
        n = b - a + 1
        if n <= max_words:
            return [(a, b)]
        cands = [i for i in range(a + min_words - 1, b - min_words + 1)]
        mid = (a + b) / 2
        best = max(cands, key=lambda i: (_priority(i, words, seps, gaps), -abs(i + 0.5 - mid)))
        if _priority(best, words, seps, gaps) == 0:
            best = int(mid)
        return rec(a, best) + rec(best + 1, b)

    return rec(0, len(words) - 1) if words else []


def pad(chunks: list[tuple[int, int]], times: list[tuple[int, int]],
        pre: int = 60, post: int = 120) -> list[tuple[int, int, int, int]]:
    """[first, last, start, end] с запасом, не заходящим в соседние слова."""
    out = []
    for first, last in chunks:
        start = times[first][0] - pre
        if first > 0:
            start = max(start, times[first - 1][1])
        end = times[last][1] + post
        if last + 1 < len(times):
            end = min(end, times[last + 1][0])
        out.append((first, last, max(start, 0), end))
    return out
