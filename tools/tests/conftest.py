import pytest


@pytest.fixture(scope="session")
def nlp():
    import spacy

    return spacy.load("en_core_web_sm")


@pytest.fixture(scope="session")
def nlp_ru():
    import spacy

    return spacy.load("ru_core_news_sm")
