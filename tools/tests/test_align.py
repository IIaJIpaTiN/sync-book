from conftest import words
from syncbook.align import chapter_cuts, match_pieces, stats, word_times


def test_exact():
    assert match_pieces(list("abcdefg"), list("abcdefg")) == list(range(7))


def test_intro_ignored():
    book = words(200)
    asr = ["this", "is", "audible"] * 10 + book
    assert match_pieces(book, asr) == [i + 30 for i in range(200)]


def test_substitution_fuzzy():
    assert match_pieces(["the", "chivalry", "x"], ["the", "chivalri", "x"]) == [0, 1, 2]


def test_short_words_not_fuzzy():
    assert match_pieces(["a", "cat", "b"], ["a", "bat", "b"]) == [0, -1, 2]


def test_skipped_passage_interpolated():
    book = words(300)
    asr = book[:100] + book[160:]  # диктор пропустил 60 слов
    m = match_pieces(book, asr)
    assert m[100:160] == [-1] * 60
    t = word_times([1] * 300, m, [(i * 300, i * 300 + 250) for i in range(len(asr))], [5] * 300)
    assert all(t[i][0] >= t[i - 1][1] and t[i][1] >= t[i][0] for i in range(1, 300))
    assert stats([x[2] for x in t]) == (0.8, 60)


def test_multi_piece_word_time():
    m = match_pieces(["well", "known", "fact"], ["well", "known", "fact"])
    t = word_times([2, 1], m, [(0, 100), (100, 300), (350, 600)], [10, 4])
    assert t == [(0, 300, False), (350, 600, False)]


def test_leading_unmatched_extrapolated():
    t = word_times([1, 1, 1], [-1, -1, 0], [(1000, 1300)], [2, 2, 3])
    assert t[2] == (1000, 1300, False)
    assert t[0] == (740, 870, True) and t[1] == (870, 1000, True)


def test_chapter_cuts():
    assert chapter_cuts([5000, 70000], [60000, 120000], 125000) == [(4000, 65000), (65000, 121500)]
