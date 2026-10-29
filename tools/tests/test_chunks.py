from syncbook.chunks import pad, split_sentence


def test_short_untouched():
    assert split_sentence(["a"] * 12, [" "] * 11, [0] * 11) == [(0, 11)]


def test_comma_preferred_over_gap():
    seps = [" "] * 17; seps[6] = ", "; gaps = [0] * 17; gaps[9] = 400
    assert split_sentence(["w"] * 18, seps, gaps) == [(0, 6), (7, 17)]


def test_recursive_split():
    seps = [" "] * 29; seps[9] = ", "; seps[19] = "; "
    assert split_sentence(["w"] * 30, seps, [0] * 29) == [(0, 9), (10, 19), (20, 29)]


def test_conjunction_used_when_no_punct():
    ws = ["w"] * 16; ws[9] = "and"
    assert split_sentence(ws, [" "] * 15, [0] * 15) == [(0, 8), (9, 15)]


def test_min_words_respected():
    seps = [" "] * 14; seps[0] = ", "
    assert all(b - a + 1 >= 3 for a, b in split_sentence(["w"] * 15, seps, [0] * 14))


def test_pad_no_overlap():
    assert pad([(0, 0), (1, 1)], [(1000, 1200), (1250, 1500)]) == [(0, 0, 940, 1250), (1, 1, 1200, 1620)]
