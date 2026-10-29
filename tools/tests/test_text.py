from syncbook.text import split_en, split_ru


def test_dialogue_not_split(nlp):
    t = '"Come here," he said. She did not move.'
    s = split_en(t, nlp)
    assert [t[x.start:x.end] for x in s] == ['"Come here," he said.', 'She did not move.']


def test_abbrev(nlp):
    assert len(split_en("Mr. Burrich came. He left.", nlp)) == 2


def test_words_offsets(nlp):
    t = "It's well-known, Fitz—truly."
    w = split_en(t, nlp)[0].words
    assert [x.text for x in w] == ["It's", "well-known", "Fitz", "truly"]
    assert all(t[x.start:x.end] == x.text for x in w)
    assert w[1].pieces == ["well", "known"] and w[0].lemma


def test_ru(nlp_ru):
    assert len(split_ru("— Иди сюда, — сказал он. Она не двинулась.", nlp_ru)) == 2
