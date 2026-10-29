# SyncBook — конвейер подготовки книг. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Python-конвейер, который из EN EPUB + RU EPUB + аудиокниги собирает файл `.syncbook` с пословными таймингами, отрывками для «Повтора», выравниванием EN↔RU и словарём.

**Architecture:** Пакет `tools/syncbook/` из модулей-стадий с чистыми функциями (тестируются pytest на маленьких фикстурах) и оркестратор `prepare.py`, который кэширует результат каждой стадии в `work/<id>/`. Тяжёлые зависимости (Whisper, LaBSE, spaCy) изолированы в тонких обёртках, алгоритмы получают на вход простые списки/массивы.

**Tech Stack:** Python 3.11, faster-whisper (large-v3, CUDA), torch (cu124), sentence-transformers (LaBSE), spaCy (`en_core_web_sm`, `ru_core_news_sm`), lxml, rapidfuzz, num2words, numpy, tomli-w, pytest; ffmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-29-syncbook-design.md` (разделы 4, 7, 8, 10)

## Global Constraints

- Python 3.11 в `tools/.venv` (системный 3.14 не поддерживается ctranslate2).
- Книги, аудио и производные данные — только в `books/`, `work/`, `output/` (в `.gitignore`); в git — только код и синтетические фикстуры.
- Все времена — целые миллисекунды. В `text/NN.json` — от начала аудиофайла главы.
- Формат данных — ровно как в спеке §4.9 (`format: 1`), имена полей не менять.
- `.syncbook` — ZIP с методом STORE для всех записей, `manifest.json` первой записью.
- Аудио глав: AAC-LC mono 48 кбит/с, 44.1 кГц, `.m4a`, `-movflags +faststart`.
- Отрывки: максимум 12 слов, минимум 3; паддинг −60 мс / +120 мс без захода в соседнее слово.
- Порог предупреждения выравнивания: < 90 % совпавших слов в главе или серия несовпадений > 40 слов. Цель на первой книге — ≥ 95 % в каждой главе с аудио.
- Команды запускаются из `tools/` с активированным venv: `.venv/Scripts/python -m pytest`.

## Review Focus

1. Типографика книги против текста ASR: `’` и `'`, слитые через тире слова (`now—and`), дефисы (`well-known`), числа цифрами у Whisper (`22` против `twenty-two`) — должны совпадать. Тесты — Task 2.
2. Текст, которого нет в книге, в начале/конце аудио (титры, «This is Audible», «End of book one») — игнорируется, первая глава начинается с первого слова книги. Тест — Task 6.
3. Пропущенный диктором или «галлюцинированный» Whisper кусок (серия > 40 несовпадений) — тайминги интерполируются монотонно, место попадает в отчёт, сборка не падает. Тест — Task 6.
4. XHTML с вложенным курсивом (`<i><b>…</b></i>`), `<br/>` внутри абзаца, пустыми `<p>` и неразрывными пробелами — текст и диапазоны курсива корректны. Тест — Task 3.
5. Разное число глав EN и RU — понятная ошибка с указанием на `book.toml`, а не молчаливый сдвиг всех глав. Тест — Task 9.

---

## Файлы

```
tools/
  requirements.txt
  pyproject.toml            настройки pytest (testpaths, pythonpath=".")
  check_env.py              проверка CUDA/ffmpeg/моделей
  syncbook/
    __init__.py
    cuda_dlls.py            подключение DLL cuDNN/cuBLAS из torch до импорта ctranslate2
    normalize.py            нормализация слов, разбиение на «кусочки», числа
    text.py                 слова и предложения блока (EN), предложения (RU)
    epub.py                 чтение EPUB: spine, toc, блоки, курсив, обложка, метаданные
    config.py               book.toml: автоопределение, чтение, запись
    audio.py                ffprobe/ffmpeg: wav для ASR, кодирование отрывка
    asr.py                  faster-whisper → asr.jsonl
    align.py                сопоставление слов, тайминги, границы глав, статистика
    chunks.py               отрывки для «Повтора»
    bilingual.py            главы RU↔EN, DP-выравнивание предложений, Embedder
    dictionary.py           словарь из kaikki.org
    formats.py              сборка JSON по спеке §4.9
    pack.py                 ZIP STORE
    report.py               HTML-отчёт о качестве
    prepare.py              CLI-оркестратор со стадиями и кэшем
    fixture.py              синтетическая мини-книга для разработки приложения
  tests/
    conftest.py             фабрики фикстур (мини-EPUB в tmp_path и т.п.)
    test_normalize.py  test_text.py  test_epub.py  test_config.py
    test_align.py  test_chunks.py  test_bilingual.py  test_dictionary.py
    test_formats.py  test_pack.py  test_prepare.py
```

Общие типы (определяются в Task 2/3, используются дальше):

```python
# text.py
@dataclass
class Word:      start: int; end: int; text: str; pieces: list[str]; lemma: str; pos: str
@dataclass
class Sentence:  start: int; end: int; words: list[Word]
# epub.py
@dataclass
class Block:     kind: str; text: str; italic: list[tuple[int, int]]    # kind: "h" | "p"
@dataclass
class EpubChapter: title: str; kind: str; blocks: list[Block]; src: list[str]  # kind: chapter|front|back
@dataclass
class EpubBook:  title: str; author: str; language: str; cover: bytes | None; chapters: list[EpubChapter]
# asr.py
@dataclass
class AsrWord:   text: str; start: int; end: int; prob: float
```

---

### Task 1: Окружение и каркас пакета

**Files:**
- Create: `tools/requirements.txt`, `tools/pyproject.toml`, `tools/check_env.py`, `tools/syncbook/__init__.py`, `tools/syncbook/cuda_dlls.py`, `tools/tests/conftest.py`

**Interfaces:**
- Produces: `syncbook.cuda_dlls.setup() -> None` — вызывается первой строкой в `asr.py` и `bilingual.Embedder`.

- [ ] **Step 1: Установить ffmpeg и Python 3.11**

Run: `winget install --id Gyan.FFmpeg -e` и `winget install --id Python.Python.3.11 -e`
Expected: `ffmpeg -version` и `py -3.11 --version` работают в новом терминале.

- [ ] **Step 2: Создать venv и поставить зависимости**

`requirements.txt`: `faster-whisper>=1.1`, `sentence-transformers>=3.0`, `spacy>=3.7,<3.9`, `lxml`, `rapidfuzz`, `num2words`, `numpy`, `tomli-w`, `pytest`. Torch — отдельно: `pip install torch --index-url https://download.pytorch.org/whl/cu124`.
Run: `py -3.11 -m venv tools/.venv`, затем pip install torch, затем `-r requirements.txt`, затем `python -m spacy download en_core_web_sm` и `ru_core_news_sm`.

- [ ] **Step 3: `cuda_dlls.setup()`** — `os.add_dll_directory(Path(torch.__file__).parent / "lib")` (там лежат cuDNN/cuBLAS для ctranslate2 на Windows); идемпотентно.

- [ ] **Step 4: `check_env.py`** печатает: версию Python, `torch.cuda.is_available()` и имя GPU, наличие ffmpeg/ffprobe, загрузку обеих моделей spaCy, создание `WhisperModel("tiny", device="cuda")`.

Run: `.venv/Scripts/python check_env.py`
Expected: все пункты `OK`, GPU `NVIDIA GeForce RTX 3070`.

- [ ] **Step 5: pytest находит пакет**

`pyproject.toml`: `[tool.pytest.ini_options] testpaths=["tests"] pythonpath=["."]`. Run: `.venv/Scripts/python -m pytest` → `no tests ran`, exit 5 без ошибок импорта.

- [ ] **Step 6: Commit** — `git add tools/ && git commit -m "chore(tools): python env and package skeleton"` (venv в `.gitignore`).

---

### Task 2: Нормализация и токенизация текста

**Files:**
- Create: `tools/syncbook/normalize.py`, `tools/syncbook/text.py`
- Test: `tools/tests/test_normalize.py`, `tools/tests/test_text.py`

**Interfaces:**
- Produces:
  - `normalize.pieces(token: str) -> list[str]` — нижний регистр, NFKC, `’`/`‘`→`'`, деление по дефисам/тире, обрезка пунктуации по краям; числа из цифр разворачиваются в слова (`num2words`, порядковые `1st`→`first`), затем делятся по дефисам.
  - `text.WORD_RE` — `[0-9A-Za-zÀ-ÿА-Яа-яЁё]+(?:['’][0-9A-Za-zÀ-ÿА-Яа-яЁё]+)*`; дефисное слово — это несколько `WORD_RE`-совпадений, которые склеиваются в одно `Word`, если между ними ровно один `-`.
  - `text.split_en(text: str, nlp) -> list[Sentence]`
  - `text.split_ru(text: str, nlp) -> list[tuple[int, int]]`

- [ ] **Step 1: Тесты нормализации**

```python
def test_apostrophes(): assert pieces("Don’t") == ["don't"]
def test_dash_glued(): assert pieces("now—and") == ["now", "and"]
def test_hyphen(): assert pieces("well-known") == ["well", "known"]
def test_digits(): assert pieces("22") == ["twenty", "two"]
def test_ordinal(): assert pieces("1st") == ["first"]
def test_edge_punct(): assert pieces("“Fitz!”") == ["fitz"]
```

- [ ] **Step 2: Тесты предложений и слов** (`nlp` — фикстура сессии `spacy.load("en_core_web_sm")`)

```python
def test_dialogue_not_split():
    s = split_en('"Come here," he said. She did not move.', nlp)
    assert [t[x.start:x.end] for x in s] == ['"Come here," he said.', 'She did not move.']
def test_abbrev(): assert len(split_en("Mr. Burrich came. He left.", nlp)) == 2
def test_words_offsets():
    w = split_en("It's well-known, Fitz—truly.", nlp)[0].words
    assert [x.text for x in w] == ["It's", "well-known", "Fitz", "truly"]
    assert w[1].pieces == ["well", "known"] and w[0].lemma
def test_ru(): assert len(split_ru("— Иди сюда, — сказал он. Она не двинулась.", nlp_ru)) == 2
```

- [ ] **Step 3: Run** `pytest tests/test_normalize.py tests/test_text.py -v` → FAIL (нет модулей).

- [ ] **Step 4: Реализовать.** Предложения — `doc.sents` spaCy, затем склейка: предложение, начинающееся со строчной буквы (после пропуска кавычек/тире), присоединяется к предыдущему. Слова — `WORD_RE` по тексту предложения; `lemma`/`pos` — у самого длинного пересекающегося токена spaCy (`token.lemma_.lower()`, `token.pos_`).

- [ ] **Step 5: Run** те же тесты → PASS. **Commit:** `feat(tools): word normalization and sentence splitting`.

---

### Task 3: Чтение EPUB

**Files:**
- Create: `tools/syncbook/epub.py`
- Test: `tools/tests/test_epub.py`; в `conftest.py` — фабрика `make_epub(tmp_path, files: dict[str, str], toc: list[tuple[str, str]], lang="en") -> Path` (строит минимальный EPUB: container.xml, OPF со spine в порядке `files`, toc.ncx).

**Interfaces:**
- Produces: `read_epub(path: Path) -> EpubBook`

Правила: порядок — `spine`; глава = запись toc + следующие файлы spine до следующей записи toc; файлы до первой записи — одна глава `front`; записи toc с заголовком по `/(about the author|also by|copyright|acknowledg|об авторе|содержание)/i` — `back`. Ведущий номер из заголовка toc отрезается (`"1 The Earliest History"` → `"The Earliest History"`). Блоки — `h1..h3` (kind `h`) и `p`/`div` без вложенных блочных потомков (kind `p`); пустые после `strip()` пропускаются; `<br/>` → пробел; ` ` → пробел; пробелы схлопываются. Курсив — диапазоны символов текста внутри `i`/`em` (вложенные теги не рвут диапазон). Метаданные — `dc:title`, `dc:creator`, `dc:language`; обложка — элемент манифеста с `properties="cover-image"` или `meta name="cover"`.

- [ ] **Step 1: Тесты**

```python
def test_chapters_grouping(tmp_path):
    p = make_epub(tmp_path, {"a.xhtml": "<p>Front</p>", "c1.xhtml": "<h1>1 One</h1><p>A</p>",
                             "c1b.xhtml": "<p>B</p>", "c2.xhtml": "<p>C</p>"},
                  toc=[("1 One", "c1.xhtml"), ("2 Two", "c2.xhtml")])
    b = read_epub(p)
    assert [(c.kind, c.title) for c in b.chapters] == [("front", ""), ("chapter", "One"), ("chapter", "Two")]
    assert [x.text for x in b.chapters[1].blocks] == ["1 One", "A", "B"]
def test_italic_nested_br_nbsp(tmp_path):
    p = make_epub(tmp_path, {"c.xhtml": "<p>He <i>said <b>no</b></i>,<br/>then left.</p><p>  </p>"},
                  toc=[("Ch", "c.xhtml")])
    blk = read_epub(p).chapters[0].blocks
    assert len(blk) == 1 and blk[0].text == "He said no, then left."
    assert blk[0].italic == [(3, 10)]
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Реализовать** на `zipfile` + `lxml.etree` (XHTML-неймспейс). **Step 4: Run** → PASS.

- [ ] **Step 5: Проверка на настоящих файлах** — скрипт-однострочник печатает число глав, заголовки и число блоков для обоих EPUB из `books/Assassin's Apprentice/`. Expected: EN — главы с «The Earliest History» … ; RU — главы с русскими заголовками; нет глав с 0 блоков.

- [ ] **Step 6: Commit** — `feat(tools): EPUB reader`.

---

### Task 4: `book.toml` и audio/ffmpeg-обёртки

**Files:**
- Create: `tools/syncbook/config.py`, `tools/syncbook/audio.py`
- Test: `tools/tests/test_config.py`

**Interfaces:**
- Produces:
  - `@dataclass BookConfig: id, title, title_ru, author, narrator, en_epub: str, ru_epub: str, audio: list[str], ru_chapter_map: dict[int, list[int]] | None` (ключи — индексы EN-глав kind=chapter)
  - `config.load_or_create(book_dir: Path) -> BookConfig` — при отсутствии `book.toml` определяет EN/RU по `dc:language`, аудио по расширениям `.m4b .m4a .mp3` (сортировка по имени), `id` = slug от названия EN, `narrator` — тег `artist`/`composer` из ffprobe, иначе текст в скобках в имени файла; записывает файл.
  - `audio.probe(paths: list[Path]) -> dict` (`duration_ms`, `chapters: [{title, start_ms, end_ms}]`, `tags`)
  - `audio.to_wav16k(paths: list[Path], out: Path) -> None`
  - `audio.encode_aac(paths: list[Path], start_ms: int, end_ms: int, out: Path) -> None`
  - Несколько входных файлов склеиваются concat-демультиплексором (временный list-файл).

- [ ] **Step 1: Тесты config** — фикстура: папка с двумя `make_epub` (en, ru) и пустым `x (Paul Boehmer).m4b`; `probe` замокан (`monkeypatch`). Проверить `id == "assassin-s-apprentice"`-подобный slug от заданного title, верные `en_epub`/`ru_epub`, `narrator == "Paul Boehmer"`, повторный вызов читает файл и не перезаписывает ручные правки.

- [ ] **Step 2: Run → FAIL; реализовать; Run → PASS.**

- [ ] **Step 3: Проверка audio на настоящей книге** — `probe` m4b печатает длительность и метки глав; `encode_aac(..., 0, 60000, work/test.m4a)` даёт файл ~360 КБ, `ffprobe` показывает `aac`, `mono`, `44100`.

- [ ] **Step 4: Commit** — `feat(tools): book config and ffmpeg wrappers`.

---

### Task 5: ASR и запуск распознавания первой книги

**Files:**
- Create: `tools/syncbook/asr.py`
- Test: `tools/tests/test_prepare.py::test_asr_roundtrip` (только сериализация)

**Interfaces:**
- Produces:
  - `asr.transcribe(wav: Path, out_jsonl: Path, prompt: str, progress: Callable[[float], None] | None = None) -> None` — `WhisperModel("large-v3", device="cuda", compute_type="float16")`, `language="en"`, `word_timestamps=True`, `vad_filter=True`, `condition_on_previous_text=False`, `beam_size=5`, `initial_prompt=prompt`. Пишет по строке JSON на слово `{"w","s","e","p"}` (мс, int) и в конце строку `{"done": true}`; при перезапуске без `done` начинает заново.
  - `asr.load(out_jsonl: Path) -> list[AsrWord]` (ошибка, если нет `done`)
  - `asr.names_prompt(chapters: list[EpubChapter], limit=60) -> str` — слова с заглавной буквы не в начале предложения, встречающиеся ≥ 5 раз, по частоте; через запятую.

- [ ] **Step 1: Тест** — записать 3 `AsrWord` в формате выше + `done`, `load` возвращает их; без `done` — `ValueError`.

- [ ] **Step 2: Run → FAIL; реализовать; Run → PASS.**

- [ ] **Step 3: Запустить распознавание первой книги в фоне** (идёт 1–2 ч, остальные задачи делаются параллельно):

Run (в фоне): `.venv/Scripts/python -c "from syncbook import ...; to_wav16k(...); transcribe(...)"` с путями `work/assassins-apprentice/02_audio.wav` и `work/assassins-apprentice/03_asr.jsonl`, лог прогресса в `work/assassins-apprentice/asr.log`.
Expected: по завершении `03_asr.jsonl` заканчивается `{"done": true}`, слов ~ 180–220 тыс.

- [ ] **Step 4: Commit** — `feat(tools): whisper transcription`.

---

### Task 6: Сопоставление слов и тайминги

**Files:**
- Create: `tools/syncbook/align.py`
- Test: `tools/tests/test_align.py`

**Interfaces:**
- Produces:
  - `match_pieces(book: list[str], asr: list[str]) -> list[int]` — для каждого кусочка книги индекс кусочка ASR или −1; совпадения строго монотонны.
  - `word_times(words_pieces: list[int], piece_match: list[int], asr_piece_time: list[tuple[int,int]], word_chars: list[int]) -> list[tuple[int, int, bool]]` — для каждого слова книги `(start, end, interpolated)`; `words_pieces[i]` — число кусочков слова i.
  - `chapter_cuts(first_starts: list[int], last_ends: list[int], total_ms: int) -> list[tuple[int, int]]`
  - `stats(interpolated: list[bool]) -> tuple[float, int]` — (доля совпавших, самая длинная серия несовпавших)

Алгоритм `match_pieces` (не определяется сигнатурой):
```
anchors = 5-граммы, встречающиеся ровно 1 раз и в book, и в asr
          → пары (i_book, j_asr) → наибольшая возрастающая подпоследовательность по j
между соседними якорями (и до первого / после последнего):
    если размер промежутка > 5000 кусочков — рекурсивно тем же способом с n=3
    иначе difflib.SequenceMatcher(None, book_gap, asr_gap, autojunk=False).get_opcodes():
        equal   → сопоставить попарно
        replace → сопоставить попарно позиции k < min(len), если
                  rapidfuzz.distance.Levenshtein.distance(a, b) <= 1 и len(a) > 4
```
`word_times`: время слова = (start первого, end последнего) совпавших кусочков; для несовпавших — линейная интерполяция между концом предыдущего и началом следующего совпавшего слова пропорционально `word_chars`; до первого/после последнего совпавшего — 65 мс на символ от ближайшего известного. Гарантии: `start <= end`, `start[i] >= end[i-1]`.
`chapter_cuts`: начало главы k = `first_starts[k] − (first_starts[k] − last_ends[k−1]) // 2` (для первой главы — `first_starts[0] − min(first_starts[0], 1000)`), конец = начало следующей; конец последней = `last_ends[-1] + min(total_ms − last_ends[-1], 1500)`.

- [ ] **Step 1: Тесты**

```python
def test_exact(): assert match_pieces(list("abcdefg"), list("abcdefg")) == list(range(7))
def test_intro_ignored():
    book = words(200); asr = ["this", "is", "audible"] * 10 + book
    assert match_pieces(book, asr) == [i + 30 for i in range(200)]
def test_substitution_fuzzy(): assert match_pieces(["the", "chivalry", "x"], ["the", "chivalri", "x"]) == [0, 1, 2]
def test_skipped_passage_interpolated():
    book = words(300); asr = book[:100] + book[160:]          # диктор пропустил 60 слов
    m = match_pieces(book, asr); assert m[100:160] == [-1] * 60
    t = word_times([1]*300, m, [(i*300, i*300+250) for i in range(len(asr))], [5]*300)
    assert all(t[i][0] >= t[i-1][1] and t[i][1] >= t[i][0] for i in range(1, 300))
    assert stats([x[2] for x in t]) == (0.8, 60)
def test_chapter_cuts(): assert chapter_cuts([5000, 70000], [60000, 120000], 125000) == [(4000, 65000), (65000, 121500)]
```
(`words(n)` — детерминированный список псевдослов `w0..wn` в conftest.)

- [ ] **Step 2: Run → FAIL; реализовать; Run → PASS.**

- [ ] **Step 3: Commit** — `feat(tools): word alignment and timing`.

---

### Task 7: Отрывки для «Повтора»

**Files:**
- Create: `tools/syncbook/chunks.py`
- Test: `tools/tests/test_chunks.py`

**Interfaces:**
- Produces:
  - `split_sentence(words: list[str], seps: list[str], gaps: list[int], max_words=12, min_words=3) -> list[tuple[int, int]]` — `seps[i]` — текст между словом i и i+1, `gaps[i]` — пауза в мс между ними; возвращает включительные диапазоны.
  - `pad(chunks, times: list[tuple[int,int]], pre=60, post=120) -> list[tuple[int, int, int, int]]` — `[first, last, start, end]`; `start >= end` предыдущего слова, `end <= start` следующего слова.

Правило выбора точки разреза: если слов ≤ max — не резать; иначе кандидаты i (разрез после слова i), у которых обе части ≥ min_words; приоритет: `seps[i]` содержит `;`, `:`, `—`, `–` (4) > содержит `,` (3) > `gaps[i] >= 250` (2) > `words[i+1].lower()` в `{and, but, or, which, that, who, when, while, because, though, as}` (1); среди лучших — ближайший к середине; если кандидатов с приоритетом нет — середина. Рекурсивно для частей.

- [ ] **Step 1: Тесты**

```python
def test_short_untouched(): assert split_sentence(["a"]*12, [" "]*11, [0]*11) == [(0, 11)]
def test_comma_preferred_over_gap():
    seps = [" "]*17; seps[6] = ", "; gaps = [0]*17; gaps[9] = 400
    assert split_sentence(["w"]*18, seps, gaps) == [(0, 6), (7, 17)]
def test_recursive_split():
    seps = [" "]*29; seps[9] = ", "; seps[19] = "; "
    assert split_sentence(["w"]*30, seps, [0]*29) == [(0, 9), (10, 19), (20, 29)]
def test_min_words_respected():
    seps = [" "]*14; seps[0] = ", "
    assert all(b - a + 1 >= 3 for a, b in split_sentence(["w"]*15, seps, [0]*14))
def test_pad_no_overlap():
    assert pad([(0, 0), (1, 1)], [(1000, 1200), (1250, 1500)]) == [(0, 0, 940, 1250), (1, 1, 1200, 1620)]
```

- [ ] **Step 2: Run → FAIL; реализовать; Run → PASS. Commit** — `feat(tools): repeat-mode chunks`.

---

### Task 8: Кодирование аудио по главам

Выполняется внутри `prepare.py` (Task 12); здесь только функция и проверка.

**Files:**
- Modify: `tools/syncbook/audio.py` — `encode_chapters(paths, cuts: list[tuple[int,int]], out_dir: Path, workers=4) -> list[int]` (параллельно через `ThreadPoolExecutor`, возвращает фактические длительности из ffprobe).

- [ ] **Step 1:** Run на первой книге с двумя тестовыми отрезками `[(0, 30000), (30000, 60000)]` → два файла `audio/01.m4a`, `audio/02.m4a`, длительности 30000 ± 50 мс.
- [ ] **Step 2: Commit** — `feat(tools): per-chapter AAC encoding`.

---

### Task 9: Выравнивание EN↔RU

**Files:**
- Create: `tools/syncbook/bilingual.py`
- Test: `tools/tests/test_bilingual.py`

**Interfaces:**
- Produces:
  - `class Embedder: def __init__(self, model="sentence-transformers/LaBSE"); def encode(self, texts: list[str]) -> np.ndarray` (L2-нормированные строки, `device="cuda"`, `batch_size=64`).
  - `default_chapter_map(en: list[EpubChapter], ru: list[EpubChapter]) -> dict[int, list[int]]` — сопоставляет главы kind=chapter по порядку; при разном количестве — `ChapterMapError` с текстом «EN: N глав, RU: M глав — задайте ru_chapter_map в book.toml».
  - `chapter_similarity(en_texts: list[str], ru_texts: list[str], emb) -> list[float]` — косинус эмбеддингов первых 3 абзацев каждой пары.
  - `align_sentences(en: np.ndarray, ru: np.ndarray, skip=-0.1) -> list[tuple[list[int], list[int]]]`
  - `group_quality(groups, en, ru) -> float` — средний косинус по группам 1+↔1+.

DP: `score(i, j)` — лучший счёт выравнивания первых i EN и j RU; шаги `(a, b)` из `{(1,1),(1,2),(2,1),(1,3),(3,1),(2,2),(1,0),(0,1)}`; вес шага с a,b>0 — `cos(norm(sum en[i-a:i]), norm(sum ru[j-b:j]))` минус `0.05 * (a + b - 2)`; шаги с нулём — `skip`. Обратный проход восстанавливает группы.

- [ ] **Step 1: Тесты** (векторы — синтетические ортонормированные, без LaBSE)

```python
def test_one_to_one(): assert align_sentences(E[:5], E[:5]) == [([i], [i]) for i in range(5)]
def test_split_merge():
    ru = np.stack([E[0], norm(E[1] + E[2]), E[3]]); ru = ru / np.linalg.norm(ru, axis=1, keepdims=True)
    assert align_sentences(E[:4], ru) == [([0], [0]), ([1, 2], [1]), ([3], [2])]
def test_chapter_count_mismatch():
    with pytest.raises(ChapterMapError, match="book.toml"): default_chapter_map(chs(24), chs(23))
```

- [ ] **Step 2: Run → FAIL; реализовать; Run → PASS.**
- [ ] **Step 3: Проверка на первой книге:** `default_chapter_map` + `chapter_similarity` для всех пар печатает таблицу; ожидается сходство > 0.5 у каждой пары. Если число глав не совпадает (EN 27 файлов / RU 26) — разобраться по заголовкам и записать `ru_chapter_map` в `book.toml`.
- [ ] **Step 4: Commit** — `feat(tools): EN-RU sentence alignment`.

---

### Task 10: Словарь

**Files:**
- Create: `tools/syncbook/dictionary.py`
- Test: `tools/tests/test_dictionary.py` (фикстура — 5 строк JSONL в формате kaikki)

**Interfaces:**
- Produces:
  - `KAIKKI_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"`; `ensure_kaikki(dest: Path) -> Path` — скачивает один раз в `work/_shared/` (с докачкой по `Range`).
  - `scan(jsonl: Path, wanted: set[str]) -> dict[str, dict]` — потоковый проход; для каждого `word` из `wanted` (нижний регистр) копит `{"ipa": str|None, "senses": [{"pos", "tr": [...]}]}`; переводы — элементы `translations` (на уровне записи и в `senses[*].translations`) с `code == "ru"`, без дублей, ≤ 5 на часть речи, ≤ 3 частей речи; IPA — первый `sounds[*].ipa` с тегом `UK`/`Received-Pronunciation`, иначе `US`, иначе первый.
  - `build(occurrences: list[tuple[str, str, str]], index: dict) -> tuple[list[dict], Callable[[str, str], int]]` — вход `(surface, lemma, pos)`; записи словаря для найденных лемм + `{"lemma": X, "name": true}` для PROPN, которые не найдены и в ≥ 90 % вхождений с заглавной; возвращает `entries` и функцию `index_of(surface, lemma) -> int` (лемма → поверхность в нижнем регистре → −1).
  - `coverage(...) -> float` — доля уникальных слов текста с `index_of >= 0`.

- [ ] **Step 1: Тесты** — `young` → `ipa == "/jʌŋ/"`, `senses[0] == {"pos": "adj", "tr": ["молодой", "юный"]}`; переводы из `senses[*].translations` тоже собираются; `Burrich` (PROPN, нет в индексе) → `name: true`; `index_of("walked", "walk")` даёт индекс `walk`.
- [ ] **Step 2: Run → FAIL; реализовать; Run → PASS.**
- [ ] **Step 3: Скачать kaikki** (≈ 2–3 ГБ, один раз) — запускается в фоне.
- [ ] **Step 4: Commit** — `feat(tools): book dictionary from Wiktionary`.

---

### Task 11: Форматы JSON, упаковка и фикстура

**Files:**
- Create: `tools/syncbook/formats.py`, `tools/syncbook/pack.py`, `tools/syncbook/fixture.py`
- Test: `tools/tests/test_formats.py`, `tools/tests/test_pack.py`

**Interfaces:**
- Consumes: `Block`, `Sentence`, `Word` (Task 2–3), результаты `word_times`, `pad`, `align_sentences`, `build`.
- Produces:
  - `formats.chapter_text(blocks: list[Block], sents: list[list[Sentence]], times: list[tuple[int,int,bool]], chunks: list[list[tuple]], dict_idx: list[int], offset_ms: int) -> dict` — ровно схема спеки §4.9 `text/NN.json`; `times`, `dict_idx` — плоские по всем словам главы; сквозные `id` предложений с 0; времена минус `offset_ms`; 6-й элемент `1` только у интерполированных слов.
  - `formats.chapter_ru(blocks: list[Block], sents: list[list[tuple[int,int]]], groups) -> dict`
  - `formats.manifest(cfg: BookConfig, chapters: list[dict]) -> dict`
  - `pack.write(out: Path, entries: list[tuple[str, Path | bytes]]) -> None` — `ZIP_STORED`, первая запись `manifest.json`, запись атомарно через `out.with_suffix(".part")` → rename.
  - `python -m syncbook.fixture <out.syncbook>` — мини-книга: 2 главы по 3 абзаца английского текста (написан в фикстуре), RU-перевод, словарь из 10 слов, аудио — `sine` через ffmpeg lavfi на длительность, равномерные тайминги 350 мс/слово.

- [ ] **Step 1: Тесты**

```python
def test_chapter_text_schema():
    d = chapter_text([Block("p", "Hi there.", [])], [split_en("Hi there.", nlp)],
                     [(1000, 1200, False), (1200, 1500, True)], [[(0, 1, 940, 1620)]], [3, -1], 1000)
    s = d["blocks"][0]["sentences"][0]
    assert s == {"id": 0, "range": [0, 9], "t": [0, 500],
                 "words": [[0, 2, 0, 200, 3], [3, 8, 200, 500, -1, 1]], "chunks": [[0, 1, 0, 620]]}
def test_zip_store(tmp_path):
    write(tmp_path / "b.syncbook", [("manifest.json", b"{}"), ("audio/01.m4a", b"x" * 10)])
    z = zipfile.ZipFile(tmp_path / "b.syncbook")
    assert z.namelist()[0] == "manifest.json" and all(i.compress_type == zipfile.ZIP_STORED for i in z.infolist())
```
(Начало отрывка после вычитания `offset_ms` и паддинга обрезается до 0: `940 − 1000 = −60 → 0`.)

- [ ] **Step 2: Run → FAIL; реализовать; Run → PASS.**
- [ ] **Step 3:** Run `python -m syncbook.fixture ../output/mini.syncbook` → файл создан, `zipfile` открывает, `manifest.json` валиден.
- [ ] **Step 4: Commit** — `feat(tools): syncbook format writer, packer and dev fixture`.

---

### Task 12: Оркестратор, отчёт и сборка первой книги

**Files:**
- Create: `tools/syncbook/prepare.py`, `tools/syncbook/report.py`
- Test: `tools/tests/test_prepare.py::test_stage_cache`

**Interfaces:**
- Produces: CLI `python -m syncbook.prepare <book_dir> [--force STAGE ...] [--only STAGE]`; стадии и кэш-файлы: `01_extract.json`, `02_audio.wav`, `03_asr.jsonl`, `04_align.json`, `05_chunks.json`, `06_audio/NN.m4a`, `07_bilingual.json`, `08_dict.json`, итог `output/<id>.syncbook` + `output/<id>.report.html`. Стадия пропускается, если её файл новее всех входов (`mtime`) и не указана в `--force`.
- `report.write(path: Path, data: dict) -> None` — HTML: таблица глав (совпадение %, макс. серия, качество EN↔RU, длительность), список предупреждений (глава, время `чч:мм:сс`, 20 слов контекста), покрытие словаря.

Сборка align: все кусочки всех EN-глав kind=chapter подряд → `match_pieces` против всех кусочков ASR → `word_times` → по главам `first_starts/last_ends` → `chapter_cuts` → `offset_ms` каждой главы = начало её отрезка. Главы `front`/`back` получают `"audio": null` и нулевые времена.

- [ ] **Step 1: Тест кэша** — стадия-заглушка вызывается один раз при двух запусках подряд и второй раз после `--force` (стадии регистрируются в словаре, тест подменяет функцию).
- [ ] **Step 2: Run → FAIL; реализовать; Run → PASS.**
- [ ] **Step 3: Полная сборка первой книги** (после завершения ASR из Task 5):

Run: `.venv/Scripts/python -m syncbook.prepare "../books/Assassin's Apprentice"`
Expected: `output/assassins-apprentice.syncbook` (≈ 350–420 МБ), отчёт без глав < 90 %; цель — ≥ 95 % в каждой главе с аудио. Если ниже — разобрать предупреждения отчёта и поправить нормализацию/выравнивание (вернуться в Task 2/6 с новым тестом на найденный случай).

- [ ] **Step 4: Выборочная проверка 10 мест** — скрипт `tools/spot_check.py` берёт 10 случайных предложений, вырезает их аудио по таймингам в `work/<id>/spot/NN.m4a`, распознаёт каждую вырезку Whisper `small` и сравнивает с текстом предложения.
Expected: у каждой вырезки ≥ 90 % слов предложения совпадают (`match_pieces`), первое и последнее слово не обрезаны. Вырезки остаются в папке, чтобы пользователь мог послушать.
- [ ] **Step 5: Commit** — `feat(tools): prepare pipeline and quality report`.
