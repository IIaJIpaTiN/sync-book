from syncbook.normalize import pieces


def test_apostrophes(): assert pieces("Don’t") == ["don't"]
def test_dash_glued(): assert pieces("now—and") == ["now", "and"]
def test_hyphen(): assert pieces("well-known") == ["well", "known"]
def test_digits(): assert pieces("22") == ["twenty", "two"]
def test_ordinal(): assert pieces("1st") == ["first"]
def test_edge_punct(): assert pieces("“Fitz!”") == ["fitz"]
def test_empty_punct_only(): assert pieces("—") == []
