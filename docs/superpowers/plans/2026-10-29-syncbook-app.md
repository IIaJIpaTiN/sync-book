# SyncBook — приложение для iPad (PWA). План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Офлайн-PWA для iPad, которая импортирует `.syncbook` и показывает книгу постранично с синхронной подсветкой аудио, режимом «Повтор», переключением EN↔RU, переводом по тапу и настройками в стиле Apple Books.

**Architecture:** Статичные файлы в `app/`, ES-модули без сборщика и фреймворка. Чистая логика (ZIP, таймлайн, автомат «Повтора», соответствие EN↔RU, настройки) — в отдельных модулях без DOM и тестируется в браузере через `app/tests/test.html`. DOM-модули (экраны, плеер, подсветка) тонкие и проверяются вручную в браузере и на iPad.

**Tech Stack:** HTML/CSS/JS (ES2022 modules), IndexedDB, OPFS, Service Worker, Media Session API; локальный сервер `python -m http.server`; GitHub Pages + GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-29-syncbook-design.md` (разделы 5, 6, 7, 8, 9)

## Global Constraints

- Целевая платформа — Safari на iPadOS 17+, приложение запускается с экрана «Домой». Для разработки — Chrome/Edge на ПК.
- Никаких сборщиков, npm и внешних CDN во время работы: всё нужное лежит в `app/`. Шрифт Literata (OFL) — `app/fonts/literata-*.woff2`.
- Все пути внутри приложения относительные (работает и на `http://localhost:8080/app/`, и на корне GitHub Pages).
- Формат входных данных — спека §4.9, `format: 1`; иной `format` — отказ импорта.
- Темы (фон / текст / акцент): бумага `#FFFFFF`/`#1D1D1F`/`#2F4B7C`, сепия `#F8F1E3`/`#4F321C`/`#2F4B7C`, серая `#4A4A4D`/`#E8E8EA`/`#AFC3EA`, ночь `#000000`/`#B4B4B8`/`#8FA8D8`. Акцент — только для линии чтеца и активных элементов.
- Шрифты книги: `"Iowan Old Style"`, `Charter`, `Palatino`, `ui-serif` (New York), `Literata`. Интерфейс — `system-ui`.
- Подписи интерфейса на русском, с заглавной только первое слово, без капса.
- Анимации: перелистывание 250 мс, панели и карточки 150 мс; `prefers-reduced-motion` — без сдвигов.
- Тексты ошибок — из спеки §7.
- Версия кэша `APP_VERSION` в `sw.js` увеличивается при каждом изменении файлов `app/`.

## Review Focus

1. Поворот iPad / смена шрифта или размера во время чтения — пересчёт страниц, текущее предложение остаётся на экране. Тест — Task 5 (`anchorPageAfterRelayout`).
2. Приложение закрыли посреди импорта — при следующем запуске недоимпортированная книга удаляется, а не висит сломанной. Тест — Task 3.
3. Конец аудио главы в режиме «Поток» — следующая глава загружается и играет дальше; после последней — остановка. Тест — Task 6 (`nextAudioChapter`).
4. Переход к отрывку в «Повторе» — воспроизведение начинается только после `seeked`, иначе Safari проигрывает кусок старой позиции. Тест — Task 7 (фейковый плеер проверяет порядок `seek → seeked → play`).
5. Тап при открытой карточке перевода — только закрывает карточку, не листает и не открывает новую. Тест — Task 4 (`classifyTap`).

---

## Файлы

```
app/
  index.html               оболочка: <div id="app">, подключение main.js и CSS
  manifest.webmanifest     name "SyncBook", display "standalone", иконки 180/192/512
  sw.js                    APP_VERSION, precache оболочки, cache-first для своих файлов
  css/
    tokens.css             темы через [data-theme], CSS-переменные настроек
    library.css  reader.css  sheet.css (панели, карточки, «Аа»)
  fonts/  icons/
  js/
    main.js                роутер (#/library, #/read/<id>), регистрация SW, cleanupIncomplete
    zip.js                 чистый: индекс ZIP STORE по Blob
    store.js               IndexedDB + OPFS
    importer.js            импорт .syncbook (+ dev-хук importFromUrl на localhost)
    library.js             экран библиотеки
    render.js              JSON главы → DOM (EN и RU)
    paginator.js           страницы через CSS columns
    taps.js                чистый: classifyTap
    reader.js              экран чтения: панели, листание, главы, оглавление, EN/RU
    timeline.js            чистый: индексы и поиск по времени
    player.js              обёртка <audio>, rAF-тики, playRange, Media Session
    sync.js                подсветка «линии чтеца», follow-режим
    repeat.js              чистый: автомат «Повтора»
    bilingual.js           чистый: EN↔RU по align
    dict.js                чистый: поиск записи словаря
    online.js              онлайн-перевод (Google gtx → MyMemory)
    cards.js               карточки слова и предложения
    settings.js            чистая часть (defaults, normalize, toCssVars) + панель «Аа»
  tests/
    test.html  harness.js  *.test.js
.claude/launch.json        сервер разработки: python -m http.server 8080 из корня репо
.github/workflows/pages.yml
```

Записи IndexedDB (БД `syncbook`, версия 1):

```js
// books:    { id, title, titleRu, author, narrator, cover: Blob, chapters: manifest.chapters,
//             dictPath, status: "importing" | "ready", importedAt, bytes }
// chapters: key [bookId, chapterId] → { en: <text/NN.json>, ru: <ru/NN.json> | null }
// dicts:    key bookId → <dict.json>
// progress: key bookId → { chapterId, sentenceId, ms, lang: "en"|"ru", updatedAt }
// settings: key "global" → объект настроек (Task 10)
// OPFS:     /books/<bookId>/audio/NN.m4a
```

---

### Task 1: Каркас PWA, темы, тест-харнесс, сервер разработки

**Files:**
- Create: `app/index.html`, `app/manifest.webmanifest`, `app/sw.js`, `app/css/tokens.css`, `app/js/main.js`, `app/tests/test.html`, `app/tests/harness.js`, `app/icons/*`, `app/fonts/literata-*.woff2`, `.claude/launch.json`

**Interfaces:**
- Produces:
  - `harness.js`: `test(name, fn)`, `assertEqual(actual, expected, msg?)` (глубокое сравнение через JSON), `assertThrows(fn, re)`, `assertRejects(promise, re)`, `run()` → рисует список и выставляет `window.__results = {passed, failed, failures: [{name, message}]}`.
  - `main.js`: `route()` по `location.hash`; экраны регистрируются как `{ mount(root, params), unmount() }`.
  - `tokens.css`: переменные `--bg --fg --muted --accent --hl --bar --line`, `--book-font --book-size --book-leading --page-margin --book-align --book-hyphens`; темы `[data-theme="paper|sepia|gray|night"]` на `<html>`.

- [ ] **Step 1:** Скачать Literata (regular, italic, bold) woff2 с Google Fonts в `app/fonts/`; иконки 180/192/512 — простой знак (открытая книга с чертой акцента) в SVG → PNG.
- [ ] **Step 2:** `sw.js`: `APP_VERSION = 1`, precache списка файлов оболочки, `activate` удаляет старые кэши, `fetch` — cache-first только для same-origin GET, остальное — сеть.
- [ ] **Step 3:** `.claude/launch.json` с конфигурацией `syncbook` (`python -m http.server 8080`, корень репо) и `harness` с пустым набором тестов.

Run: открыть `http://localhost:8080/app/tests/test.html`
Expected: `window.__results` = `{passed: 0, failed: 0}`.

- [ ] **Step 4:** `http://localhost:8080/app/` открывает пустую библиотеку; в DevTools → Application SW активен, офлайн-перезагрузка отдаёт оболочку.
- [ ] **Step 5: Commit** — `feat(app): PWA shell, themes, test harness`.

---

### Task 2: Чтение ZIP STORE

**Files:**
- Create: `app/js/zip.js`; Test: `app/tests/zip.test.js` (+ хелпер `makeStoreZip(entries)` в `harness.js` для генерации тестовых архивов)

**Interfaces:**
- Produces:
  - `readZipIndex(blob: Blob) -> Promise<Map<string, {offset: number, size: number}>>` — ищет EOCD в последних 65 557 байтах, читает центральный каталог, по локальному заголовку вычисляет начало данных (`30 + nameLen + extraLen`).
  - `entryBlob(blob, entry) -> Blob` = `blob.slice(offset, offset + size)`.
  - `class ZipError extends Error { code: "not-zip" | "compressed" | "zip64" }`.

- [ ] **Step 1: Тесты** — индекс двух записей и чтение содержимого через `entryBlob(...).text()`; запись с методом 8 → `ZipError` `compressed`; случайные байты → `not-zip`; файл, сгенерированный `syncbook.fixture` (`/output/mini.syncbook`), содержит `manifest.json` первой записью.
- [ ] **Step 2:** Run `test.html` → FAIL. **Step 3:** Реализовать (DataView, little-endian). **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(app): ZIP STORE reader`.

---

### Task 3: Хранилище и импорт

**Files:**
- Create: `app/js/store.js`, `app/js/importer.js`; Test: `app/tests/importer.test.js`

**Interfaces:**
- Consumes: `readZipIndex`, `entryBlob`, `ZipError` (Task 2).
- Produces:
  - `store.js`: `db()`; `putBook(rec)`, `getBooks()`, `getBook(id)`, `deleteBook(id)` (удаляет записи всех хранилищ и папку OPFS); `putChapter(bookId, chId, {en, ru})`, `getChapter(bookId, chId)`; `putDict/getDict(bookId)`; `getProgress/putProgress(bookId, p)`; `getSettings()/putSettings(s)`; `writeAudio(bookId, name, blob, onBytes)` (через `createWritable`, кусками по 8 МБ), `audioFile(bookId, name) -> Promise<File|null>`, `hasAllAudio(book) -> Promise<boolean>`.
  - `importer.js`: `importSyncbook(blob: Blob, onProgress: (f: number) => void) -> Promise<BookRecord>`; `cleanupIncomplete() -> Promise<number>` (удаляет книги со `status: "importing"`); `class ImportError extends Error { code: "format" | "space" | "corrupt" }`. На localhost экспортирует `window.__syncbook = { importFromUrl(url) }` (fetch → Blob → `importSyncbook`).

Порядок импорта: индекс ZIP → `manifest.json` → проверка `format === 1` → `navigator.storage.estimate()` (нужно суммарный размер записей × 1.1, иначе `ImportError("space")` с числом МБ) → `navigator.storage.persist()` → `putBook({...status: "importing"})` → главы/RU/словарь → аудио → `status: "ready"`. Любая ошибка после `putBook` → `deleteBook(id)` и проброс. Повторный импорт той же книги заменяет её, прогресс сохраняется.

- [ ] **Step 1: Тесты** (на `mini.syncbook` и сгенерированных архивах)

```js
test("import mini book", async () => {
  const rec = await importSyncbook(await (await fetch("/output/mini.syncbook")).blob(), () => {});
  assertEqual(rec.status, "ready");
  assertEqual((await getChapter(rec.id, "01")).en.blocks.length > 0, true);
  assertEqual((await audioFile(rec.id, "01.m4a")).size > 0, true);
});
test("wrong format rejected and nothing left", async () => {
  await assertRejects(importSyncbook(makeStoreZip({"manifest.json": '{"format":2,"id":"x"}'})), /format/);
  assertEqual(await getBook("x"), undefined);
});
test("cleanupIncomplete removes half-imported", async () => {
  await putBook({ id: "half", status: "importing", chapters: [] });
  assertEqual(await cleanupIncomplete(), 1); assertEqual(await getBook("half"), undefined);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Реализовать. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `feat(app): storage and syncbook import`.

---

### Task 4: Библиотека и классификация тапов

**Files:**
- Create: `app/js/library.js`, `app/css/library.css`, `app/js/taps.js`; Test: `app/tests/taps.test.js`

**Interfaces:**
- Produces:
  - `library.js`: экран `{mount, unmount}`; сетка обложек (`cover` Blob → object URL) с процентом прочитанного (`progress` → индекс главы/число глав), «Импорт» (`<input type=file accept=".syncbook">`, полоса прогресса), долгий тап 600 мс → лист «Удалить книгу» с подтверждением; книга с `hasAllAudio === false` помечена «Нужен повторный импорт»; пустое состояние: заголовок «Добавьте первую книгу», текст про `.syncbook` и «Файлы», кнопка «Импорт».
  - `taps.js`: `classifyTap({x, width, onWord, cardOpen}) -> "close-card" | "word" | "prev" | "next" | "chrome"` — `cardOpen` → `close-card`; `onWord` → `word`; иначе `x < width/3` → `prev`, `x > 2*width/3` → `next`, иначе `chrome`.

- [ ] **Step 1: Тесты `classifyTap`** — все пять исходов, включая `cardOpen: true, onWord: true → "close-card"`.
- [ ] **Step 2:** Run → FAIL; реализовать `taps.js`; Run → PASS.
- [ ] **Step 3:** Реализовать библиотеку. Проверка в браузере: импорт `mini.syncbook` через `__syncbook.importFromUrl`, обложка появляется, удаление работает, пустое состояние после удаления.
- [ ] **Step 4: Commit** — `feat(app): library screen and tap classification`.

---

### Task 5: Рендер главы, пагинация, экран чтения

**Files:**
- Create: `app/js/render.js`, `app/js/paginator.js`, `app/js/reader.js`, `app/css/reader.css`; Test: `app/tests/paginator.test.js`

**Interfaces:**
- Consumes: `getChapter`, `getProgress/putProgress`, `classifyTap`.
- Produces:
  - `render.renderEn(chapter, chapterMeta) -> HTMLElement` — блок `h` → `<h2>`, `p` → `<p>`; каждое предложение `<span class="s" data-s="ID">`, слово `<span class="w" data-w="GLOBAL_INDEX" data-d="DICT_INDEX">`; глобальный индекс слова — сквозной по главе в порядке появления; курсив — `<i>` по `italic` (разрезается на границах span-ов). Текст между словами — текстовые узлы как в исходнике.
  - `render.renderRu(ruChapter) -> HTMLElement` — предложения `<span class="rs" data-rs="ID">`, без слов.
  - `class Paginator { constructor(viewport: HTMLElement, content: HTMLElement); layout() -> number /*pages*/; get page; goTo(page, {animate}); pageOf(el) -> number; get spread /*1|2*/ }` — `spread = 2`, если `matchMedia("(orientation: landscape) and (min-width: 1000px)")`; `content` — CSS columns с `column-width` = ширина страницы, `column-gap` = 2 × поле; листание — `transform: translateX(-page * viewportWidth / spread)`; при `spread=2` «страница» = левая колонка разворота, шаг — 2 колонки.
  - `anchorPageAfterRelayout(paginator, anchorEl) -> number` — после `layout()` возвращает `pageOf(anchorEl)` (для разворота — округление вниз до чётной).
  - `reader.js`: экран `#/read/<bookId>` — загрузка главы из прогресса, верхняя/нижняя панели (разметка из макета спеки §6), тапы через `classifyTap`, свайп (|dx| > 40 px, |dx| > |dy|), переход в соседнюю главу на границе, оглавление (лист со списком глав), автоскрытие панелей через 3 с. `ResizeObserver` + `orientationchange` → `layout()` + `anchorPageAfterRelayout` по первому предложению текущей страницы.

- [ ] **Step 1: Тесты пагинатора** (в `test.html` создаётся скрытый viewport 800×600 и контент из 40 абзацев)

```js
test("pageOf finds element page", () => { const p = mk(); const n = p.layout();
  assertEqual(n > 2, true); const last = p.content.lastElementChild; assertEqual(p.pageOf(last), n - 1); });
test("anchor survives font change", () => { const p = mk(); p.layout(); const el = p.content.children[20];
  p.goTo(p.pageOf(el)); p.content.style.fontSize = "24px"; p.layout();
  assertEqual(anchorPageAfterRelayout(p, el), p.pageOf(el)); });
```

- [ ] **Step 2:** Run → FAIL; реализовать `paginator.js`; Run → PASS.
- [ ] **Step 3:** Реализовать `render.js` и `reader.js`. Проверка в браузере (`resize_window` 1180×820 и 820×1180): разворот/одна страница, листание тапом и свайпом, переход между главами, оглавление; после смены ориентации видна та же фраза.
- [ ] **Step 4: Commit** — `feat(app): chapter rendering, pagination, reader screen`.

---

### Task 6: Плеер, таймлайн и подсветка «Потока»

**Files:**
- Create: `app/js/timeline.js`, `app/js/player.js`, `app/js/sync.js`; Test: `app/tests/timeline.test.js`

**Interfaces:**
- Produces:
  - `timeline.build(chapterJson) -> Timeline` — `{ wStart: Int32Array, wEnd: Int32Array, wSent: Int32Array /*индекс предложения*/, sentences: [{id, firstWord, lastWord, t}], chunks: [{s /*индекс предложения*/, first, last, start, end}] }`; индексы слов совпадают с `data-w` из `render.js`.
  - `timeline.wordAt(tl, ms) -> number` — последнее слово с `wStart <= ms`; −1 до первого слова.
  - `timeline.chunkAt(tl, ms) -> number`, `timeline.firstChunkOfSentence(tl, sIdx) -> number`.
  - `timeline.nextAudioChapter(chapters, idx) -> number` — следующий индекс с `audio !== null`, иначе −1.
  - `class Player extends EventTarget` — `load(file: File, ms)`, `play()`, `pause()`, `seek(ms) -> Promise<void>` (резолвится на `seeked`), `get ms`, `set rate(r)` (+ `preservesPitch = true`), `playRange(startMs, endMs) -> Promise<"done" | "interrupted">` (seek → seeked → play; rAF-проверка `ms >= endMs` → pause); события `tick` (каждый кадр во время проигрывания, `detail.ms`), `ended`, `playstate`.
  - `class Highlighter { constructor(root, tl, mode /*"both"|"sentence"|"word"|"off"*/); update(ms) -> {wordEl, sentenceId} ; setMode(m); clear() }` — переключает классы `.s-on` и `.w-on` только при смене индекса.
  - `reader.js` (изменение): нижняя панель управляет `Player`; follow-режим: если `wordEl` вне текущего разворота и `follow` — `goTo(pageOf(wordEl))`; ручное листание → `follow=false` и кнопка «К чтецу»; `follow` возвращается, когда `wordEl` снова на видимой странице или по кнопке; долгий тап 500 мс по слову → меню «Читать отсюда» / «Перевести предложение»; на `ended` → `nextAudioChapter` → загрузка главы и продолжение; −1 → стоп. Прогресс: `putProgress` при смене предложения не чаще раза в 2 с и на `visibilitychange: hidden`.
  - `css/reader.css`: `.s-on { background: var(--hl); box-shadow: 0 0 0 2px var(--hl); border-radius: 3px }`, `.w-on { box-shadow: inset 0 -2px var(--accent) }`.

- [ ] **Step 1: Тесты таймлайна** — на JSON из `mini.syncbook`: `wordAt(tl, -1) === -1`, `wordAt(tl, wStart[5]) === 5`, `wordAt(tl, wEnd[5] + 1)` (пауза между словами) `=== 5`; `nextAudioChapter([{audio:"a"},{audio:null},{audio:"b"}], 0) === 2`, `(…, 2) === -1`.
- [ ] **Step 2:** Run → FAIL; реализовать `timeline.js`; Run → PASS.
- [ ] **Step 3:** Реализовать `player.js`, `sync.js`, изменения `reader.js`. Проверка на настоящей книге (импорт через `importFromUrl("/output/assassins-apprentice.syncbook")`): подсветка идёт за голосом, автоперелистывание, «К чтецу», переход главы, скорость 0.75×/1.5×.
- [ ] **Step 4: Commit** — `feat(app): audio player and read-along highlighting`.

---

### Task 7: Режим «Повтор»

**Files:**
- Create: `app/js/repeat.js`; Modify: `app/js/reader.js`, `app/css/reader.css`; Test: `app/tests/repeat.test.js`

**Interfaces:**
- Consumes: `Timeline`, `Player.playRange`, `Player.seek`.
- Produces: `createRepeat({ player, timeline, clock, getSettings, onState }) -> { start(chunkIdx), next(), prev(), replay(), proceed(), stop() }`
  - `clock` — `{ now(): number, after(ms, fn): cancelFn }` (в тестах — фейковый).
  - Состояние для `onState`: `{ phase: "playing" | "gap" | "waiting" | "idle", chunk, rep, gapMs, gapEndsAt }`.
  - Переходы: `start(i)` → `playing` (`playRange(chunk.start, chunk.end)`); `"done"` → если `rep < repeats` → снова `playing` с `rep+1`; иначе `repeatMode === "auto"` → `gap` на `round((end − start) × gapFactor / rate)`, по истечении → `start(i+1)`; `"manual"` → `waiting`, `proceed()` → `start(i+1)`. `next/prev/replay` отменяют текущий таймер/воспроизведение. Последний отрывок главы → `idle` и событие для перехода в следующую главу. `"interrupted"` → `idle`.
  - UI: переключатель «Поток / Повтор» в нижней панели; в «Повторе» — кнопки «Назад», «Повторить», «Дальше», подпись «Повторите вслух · N с» во время паузы; под отрывком тонкая черта-индикатор, заполняемая за `gapMs` (CSS-анимация `transform: scaleX`); тап по предложению → `start(firstChunkOfSentence)`. При `visibilitychange: hidden` в «Повторе» → `stop()` + пауза.

- [ ] **Step 1: Тесты** (фейковый плеер пишет журнал вызовов, `playRange` резолвится по команде теста)

```js
test("auto: play → gap → next", async () => { const r = mk({repeatMode: "auto", gapFactor: 1.5, repeats: 1});
  r.start(0); await fp.finish(); assertEqual(last().phase, "gap"); assertEqual(last().gapMs, 1.5 * len(0));
  clock.advance(last().gapMs); assertEqual(last().chunk, 1); });
test("repeats twice before moving on", async () => { const r = mk({repeats: 2}); r.start(0);
  await fp.finish(); assertEqual(last(), {...last(), phase: "playing", chunk: 0, rep: 2}); });
test("manual waits for proceed", async () => { const r = mk({repeatMode: "manual"}); r.start(0);
  await fp.finish(); assertEqual(last().phase, "waiting"); clock.advance(60000); assertEqual(last().chunk, 0);
  r.proceed(); assertEqual(last().chunk, 1); });
test("next cancels pending gap", async () => { const r = mk({}); r.start(0); await fp.finish(); r.next();
  clock.advance(100000); assertEqual(fp.calls.filter(c => c.op === "playRange").length, 2); });
test("seek completes before play", async () => { /* реальный Player с фейковым <audio> */
  assertEqual(audioLog.join(","), "currentTime=,seeked,play"); });
```

- [ ] **Step 2:** Run → FAIL; реализовать; Run → PASS.
- [ ] **Step 3:** Проверка на настоящей книге: отрывки начинаются и кончаются на границах слов, пауза пропорциональна длине, ручной режим, повторы.
- [ ] **Step 4: Commit** — `feat(app): repeat mode`.

---

### Task 8: Переключение EN ↔ RU

**Files:**
- Create: `app/js/bilingual.js`; Modify: `app/js/reader.js`; Test: `app/tests/bilingual.test.js`

**Interfaces:**
- Produces:
  - `ruFor(enSentenceId, align) -> number | null` — первое RU-предложение группы, содержащей EN-предложение; для группы 1–0 — ближайшая предыдущая группа с RU, иначе следующая.
  - `enFor(ruSentenceId, align) -> number | null` — симметрично.
  - `groupFor(enSentenceId, align) -> {en: number[], ru: number[]}`.
  - `reader.js`: кнопка EN/RU — запоминает якорное предложение (звучащее, если играет, иначе первое на странице), рендерит другой язык (`renderEn`/`renderRu`), `layout()`, `goTo(pageOf(якорь))`; при RU подсветка выключена, follow не листает; язык сохраняется в `progress.lang`. Глава без `ru` — кнопка показывает «Перевода этой главы нет».

- [ ] **Step 1: Тесты** — `align = [[[0],[0]], [[1,2],[1]], [[3],[]], [[4],[2,3]]]`: `ruFor(2) === 1`, `ruFor(3) === 1`, `ruFor(4) === 2`, `enFor(3) === 4`, `groupFor(1)` → `{en:[1,2], ru:[1]}`.
- [ ] **Step 2:** Run → FAIL; реализовать; Run → PASS.
- [ ] **Step 3:** Проверка на книге: переключение туда-обратно в середине главы возвращает к тому же месту.
- [ ] **Step 4: Commit** — `feat(app): EN-RU switching`.

---

### Task 9: Перевод слова и предложения

**Files:**
- Create: `app/js/dict.js`, `app/js/online.js`, `app/js/cards.js`, `app/css/sheet.css`; Modify: `app/js/reader.js`; Test: `app/tests/dict.test.js`

**Interfaces:**
- Consumes: `getDict`, `groupFor`, `Player.playRange`, `classifyTap`.
- Produces:
  - `dict.entryFor(dict, dictIndex) -> Entry | null`; `dict.formatSenses(entry) -> [{pos: "прил." | "сущ." | "гл." | "нар." | "предл." | "мест." | "союз" | "межд." | "числ." | <как есть>, tr: string}]`.
  - `online.translate(text, from = "en", to = "ru", {signal}) -> Promise<string>` — сначала `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=…` (результат — `json[0].map(x => x[0]).join("")`), при ошибке — `https://api.mymemory.translated.net/get?q=…&langpair=en|ru` (`responseData.translatedText`); таймаут 8 с; `navigator.onLine === false` → `Error("offline")`.
  - `cards.showWordCard(anchorEl, {surface, entry, onVoice, onSentence, onOnline})`, `cards.showSentenceCard(anchorEl, {en, ru, onOnline})`, `cards.close()`, `cards.isOpen()`. Позиционирование: под словом, если места нет — над; не выходит за края. Вид — из макета спеки §6 (слово крупно шрифтом книги, IPA и часть речи справа, переводы, кнопки «Голос чтеца», «Предложение»/«Перевести онлайн»). Офлайн-ошибка — строка «Нет подключения к интернету» в карточке. Имя (`name: true`) — подпись «Имя собственное».
  - `reader.js`: тап `word` → пауза (если `pauseOnTranslate`) и карточка; «Голос чтеца» → `playRange(wStart−40, wEnd+60)` с возвратом на прежнюю позицию; закрытие карточки возобновляет звук, если он играл до неё.

- [ ] **Step 1: Тесты** — `entryFor(d, -1) === null`; `formatSenses({senses:[{pos:"adj", tr:["молодой","юный"]}]})` → `[{pos:"прил.", tr:"молодой, юный"}]`; `online.translate` с подменённым `fetch` (первый провайдер бросает) берёт результат второго.
- [ ] **Step 2:** Run → FAIL; реализовать; Run → PASS.
- [ ] **Step 3:** Проверка в браузере: карточка слова, голос чтеца, карточка предложения с русским фрагментом, онлайн-перевод, офлайн-сообщение (DevTools offline), тап вне карточки только закрывает её.
- [ ] **Step 4: Commit** — `feat(app): word and sentence translation`.

---

### Task 10: Настройки «Аа»

**Files:**
- Create: `app/js/settings.js`; Modify: `app/js/reader.js`, `app/css/sheet.css`; Test: `app/tests/settings.test.js`

**Interfaces:**
- Produces:
  - `DEFAULTS = { theme: "sepia", font: "iowan", sizeStep: 4, leading: "normal", margins: "normal", align: "justify", hyphens: true, rate: 1.0, highlight: "both", repeatMode: "auto", gapFactor: 1.5, repeats: 1, pauseOnTranslate: true }`
  - `SIZES = [14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 32]` (px, 12 шагов); `LEADING = {tight: 1.45, normal: 1.6, loose: 1.8}`; `MARGINS = {narrow: 24, normal: 48, wide: 80}` (px); `FONTS = {iowan: '"Iowan Old Style", serif', charter: 'Charter, serif', palatino: 'Palatino, "Palatino Linotype", serif', newyork: 'ui-serif, Georgia, serif', literata: 'Literata, serif'}`.
  - `normalize(s) -> Settings` — недостающие ключи из `DEFAULTS`, `rate` ограничен 0.5–2.0 и округлён до 0.05, `gapFactor` 1.0–3.0 (шаг 0.1), `repeats` 1–3, `sizeStep` 0–11.
  - `toCssVars(s) -> Record<string, string>`; `apply(s)` — `data-theme` + переменные на `document.documentElement`.
  - Панель «Аа» (лист под кнопкой): темы кружками, шрифты списком (каждый своим шрифтом), «A− A+», межстрочный интервал и поля — сегменты, выравнивание, переносы, скорость (слайдер + значение `0.90×`), подсветка, раздел «Повтор» (авто/ручной, коэффициент, повторы), «Пауза при переводе». Любое изменение → `normalize` → `putSettings` → `apply` → `layout()` + якорь (Task 5) → `Player.rate`, `Highlighter.setMode`.

- [ ] **Step 1: Тесты** — `normalize({rate: 2.33})` → `rate === 2.0`; `normalize({rate: 0.87})` → `0.85`; `normalize({})` deep-equals `DEFAULTS`; `toCssVars({...DEFAULTS, sizeStep: 7})["--book-size"] === "22px"`.
- [ ] **Step 2:** Run → FAIL; реализовать; Run → PASS.
- [ ] **Step 3:** Проверка в браузере всех четырёх тем (сравнить с макетом), смены шрифта/размера с сохранением места, сохранения настроек после перезагрузки.
- [ ] **Step 4: Commit** — `feat(app): reading settings`.

---

### Task 11: Media Session, ошибки, офлайн-полировка

**Files:**
- Modify: `app/js/player.js`, `app/js/reader.js`, `app/js/library.js`, `app/js/main.js`, `app/sw.js`

**Interfaces:**
- Produces:
  - `player.js`: `setMediaMeta({title, chapter, cover: Blob})` → `navigator.mediaSession.metadata` (artwork — object URL обложки), обработчики `play`, `pause`, `seekbackward`/`seekforward` (15 с), `previoustrack`/`nexttrack` → соседняя глава.
  - Ошибки из спеки §7: глава без аудиофайла → «Аудио этой главы недоступно», панель плеера скрыта; книга без файлов в OPFS → в библиотеке «Нужен повторный импорт», открытие ведёт к импорту; `ImportError` → текст причины в листе импорта (`format`: «Этот файл не подходит: версия формата N», `space`: «Не хватает места: нужно ещё N МБ», `corrupt`: «Файл повреждён. Соберите книгу заново»).
  - `main.js`: на старте `cleanupIncomplete()`; `sw.js` — `APP_VERSION` увеличен, список precache полный.

- [ ] **Step 1:** Реализовать.
- [ ] **Step 2: Проверка в браузере:** режим offline в DevTools → приложение и импортированная книга открываются, играют, словарь работает; удалённый вручную файл главы в OPFS (через `javascript_tool`) → сообщение и текст без плеера.
- [ ] **Step 3:** Прогнать `tests/test.html` целиком → `failed: 0`.
- [ ] **Step 4: Commit** — `feat(app): media session, error states, offline polish`.

---

### Task 12: Публикация на GitHub Pages и проверка на iPad

**Files:**
- Create: `.github/workflows/pages.yml`, `README.md` (как собрать книгу, как установить на iPad)

**Interfaces:**
- Produces: workflow на `push` в `main`: `actions/checkout@v4` → `actions/configure-pages@v5` → `actions/upload-pages-artifact@v3` (`path: app`) → `actions/deploy-pages@v4`; права `pages: write`, `id-token: write`.

- [ ] **Step 1:** Пользователь создаёт пустой репозиторий на GitHub (публичный, т.к. бесплатный Pages) и включает Pages → Source: GitHub Actions. Claude добавляет `origin` и после подтверждения пользователя делает `git push`. Перед пушем — `git ls-files` не содержит ничего из `books/`, `work/`, `output/`.
- [ ] **Step 2:** Workflow зелёный, `https://<user>.github.io/<repo>/` открывает библиотеку.
- [ ] **Step 3: Проверка на iPad** (пользователь, по чек-листу из README): «На экран Домой»; импорт `assassins-apprentice.syncbook` из «Файлов»; авиарежим → запуск и чтение; «Поток» с подсветкой и автоперелистыванием; блокировка экрана — звук идёт, управление с экрана блокировки; «Повтор» авто и ручной; EN↔RU; карточка слова и голос чтеца; онлайн-перевод при включённой сети; поворот экрана; смена темы и размера шрифта.
- [ ] **Step 4:** Исправления по результатам — отдельными коммитами с увеличением `APP_VERSION`.
- [ ] **Step 5: Commit** — `chore: GitHub Pages deployment`.
