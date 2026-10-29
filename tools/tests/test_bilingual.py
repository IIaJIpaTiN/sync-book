import numpy as np
import pytest

from syncbook.bilingual import ChapterMapError, align_sentences, default_chapter_map, group_quality
from syncbook.epub import Block, EpubChapter

E = np.eye(8)


def norm(v):
    return v / np.linalg.norm(v)


def chs(n, kind="chapter"):
    return [EpubChapter(f"c{i}", kind, [Block("p", "x")], []) for i in range(n)]


def test_one_to_one():
    assert align_sentences(E[:5], E[:5]) == [([i], [i]) for i in range(5)]


def test_split_merge():
    ru = np.stack([E[0], norm(E[1] + E[2]), E[3]])
    assert align_sentences(E[:4], ru) == [([0], [0]), ([1, 2], [1]), ([3], [2])]


def test_untranslated_sentence_skipped():
    assert align_sentences(E[:3], np.stack([E[0], E[2]])) == [([0], [0]), ([1], []), ([2], [1])]


def test_quality():
    assert group_quality([([0], [0]), ([1], [])], E[:2], E[:1]) == pytest.approx(1.0)


def test_chapter_map_skips_front():
    assert default_chapter_map(chs(1, "front") + chs(2), chs(1, "front") + chs(2)) == {0: [0], 1: [1]}


def test_chapter_count_mismatch():
    with pytest.raises(ChapterMapError, match="book.toml"):
        default_chapter_map(chs(24), chs(23))


def test_split_shared_ru_chapter():
    from syncbook.bilingual import split_shared

    groups = [([0], [0]), ([1], [1]), ([], [2]), ([2], [3]), ([3], [4])]
    ru_block = [0, 0, 1, 2, 2]
    parts = split_shared(groups, [2, 2], ru_block)
    assert parts == [([([0], [0]), ([1], [1]), ([], [2])], (0, 2), 0),
                     ([([0], [0]), ([1], [1])], (2, 3), 3)]


def test_split_shared_paragraph_straddles():
    from syncbook.bilingual import split_shared

    # оба RU-предложения в одном абзаце: абзац целиком уходит второй главе
    parts = split_shared([([0], [0]), ([1], [1])], [1, 1], [0, 0])
    assert parts == [([([0], [])], (0, 0), 0), ([([0], [1])], (0, 1), 0)]
