// Экран чтения: глава постранично, панели, листание тапом и свайпом, оглавление, переход между главами.
import { getBook, getChapter, getProgress, putProgress } from './store.js';
import { renderEn, renderRu } from './render.js';
import { Paginator, autoSpread, anchorPageAfterRelayout } from './paginator.js';
import { classifyTap } from './taps.js';
import { createSlide, dragProgress, shouldComplete } from './pageturn.js';
import { go } from './main.js';
import { h, sheet } from './ui.js';
import { icon } from './icons.js';
import {
  bookPosition, cachedCounts, chapterStartPages, folioText, formatDuration, layoutKey, measureBook,
} from './bookpages.js';

const SWIPE_PX = 40;
const DRAG_START_PX = 12;
const MEASURE_DELAY_MS = 700;
const CHROME_HIDE_MS = 3000;

export function readerScreen() {
  const st = {
    book: null,
    index: 0, // индекс главы в book.chapters
    data: null, // { en, ru } из IndexedDB
    lang: 'en',
    paginator: null,
    anchor: null, // элемент предложения, который держим на экране при перерасчёте
    chrome: true,
    hideTimer: null,
    resize: null,
    gen: 0, // номер последнего запроса главы: устаревшие загрузки отбрасываются
    loading: false,
    numbering: 'chapter', // колонтитул: страницы главы или всей книги
    counts: null, // число страниц каждой главы при текущей вёрстке (считается в фоне)
    countsKey: null,
    measureTimer: null,
  };
  const el = {};

  // ---------- разметка ----------
  function build(root) {
    el.title = h('div', { class: 'bar-title' });
    el.langBtn = h('button', { class: 'seg', 'aria-label': 'Язык текста', onclick: () => api.toggleLang() },
      h('span', { class: 'seg-opt on', 'data-v': 'en' }, 'EN'), h('span', { class: 'seg-opt', 'data-v': 'ru' }, 'RU'));
    el.aa = h('button', { class: 'bar-btn aa', 'aria-label': 'Оформление', onclick: () => api.emit('settings') }, 'Aa');
    el.top = h('header', { class: 'bar top' },
      h('div', { class: 'bar-side' },
        h('button', { class: 'bar-btn', 'aria-label': 'Библиотека', onclick: () => go('#/library') }, icon('library')),
        h('button', { class: 'bar-btn', 'aria-label': 'Оглавление', onclick: showToc }, icon('list'))),
      el.title,
      h('div', { class: 'bar-side right' }, el.langBtn, el.aa));
    el.content = h('div', { class: 'content' });
    el.viewport = h('div', { class: 'viewport' }, el.content);
    el.runhead = h('div', { class: 'runhead' });
    el.folio = h('div', { class: 'folio' });
    el.left = h('div', { class: 'bar-left' });
    el.center = h('div', { class: 'bar-center' });
    el.pageNum = h('span', { class: 'page-num' });
    el.remaining = h('span', { class: 'remaining' });
    el.pageinfo = h('button', {
      class: 'pageinfo', 'aria-label': 'Нумерация страниц: глава или книга',
      onclick: () => api.emit('numbering-toggle'),
    }, el.pageNum, el.remaining);
    el.right = h('div', { class: 'bar-right' }, el.pageinfo);
    el.bottom = h('footer', { class: 'bar bottom' }, el.left, el.center, el.right);
    el.reader = h('div', { class: 'reader chrome-on' }, el.runhead, el.viewport, el.folio, el.top, el.bottom);
    root.append(el.reader);
    bindGestures();
  }

  // ---------- главы и страницы ----------
  async function openChapter(index, { sentenceId = null, page = 0, toEnd = false, rsId = null } = {}) {
    const gen = ++st.gen;
    const idx = Math.max(0, Math.min(index, st.book.chapters.length - 1));
    const meta = st.book.chapters[idx];
    st.loading = true;
    const data = await getChapter(st.book.id, meta.id);
    if (gen !== st.gen) return false; // за время чтения открыли другую главу
    st.loading = false;
    st.index = idx;
    st.data = data;
    if (st.lang === 'ru' && !st.data.ru) st.lang = 'en';
    const body = st.lang === 'ru' ? renderRu(st.data.ru) : renderEn(st.data.en);
    el.content.replaceChildren(...body.childNodes);
    el.title.textContent = st.lang === 'ru' && meta.titleRu ? meta.titleRu : meta.title;
    el.runhead.textContent = el.title.textContent;
    updateLangBtn();
    st.paginator = new Paginator(el.viewport, el.content, { spread: autoSpread() });
    st.paginator.layout();
    let target = page;
    const anchorSel = sentenceId != null ? `[data-s="${sentenceId}"]` : rsId != null ? `[data-rs="${rsId}"]` : null;
    const anchorEl = anchorSel && el.content.querySelector(anchorSel);
    if (anchorEl) target = st.paginator.pageOf(anchorEl);
    if (toEnd) target = st.paginator.pages - 1;
    if (st.counts) st.counts[st.index] = st.paginator.pages;
    st.cardClone = null;
    showPage(target);
    api.emit('chapter', { index: st.index, meta });
    scheduleMeasure();
  }

  function showPage(page) {
    st.paginator.goTo(page);
    afterPageChange();
  }

  function afterPageChange() {
    st.anchor = firstVisibleSentence();
    updateFolio();
    saveProgress();
    api.emit('page', { page: st.paginator.page });
  }

  function updateFolio() {
    const text = folioText({
      mode: st.numbering, page: st.paginator.page, pages: st.paginator.pages, counts: st.counts, index: st.index,
    });
    el.folio.textContent = text;
    el.pageNum.textContent = `стр. ${text}`;
  }

  // Страницы всей книги считаются в фоне; при смене вёрстки — заново (из кэша, если уже считали).
  function scheduleMeasure() {
    clearTimeout(st.measureTimer);
    st.measureTimer = setTimeout(async () => {
      const spread = st.paginator.spread;
      const key = layoutKey(el.viewport, { lang: st.lang, spread });
      if (st.countsKey === key) return;
      const counts = cachedCounts(st.book.id, key) || await measureBook({
        book: st.book, lang: st.lang, spread, viewport: el.viewport, host: el.reader, key,
        isStale: () => !el.reader.isConnected || layoutKey(el.viewport, { lang: st.lang, spread: st.paginator.spread }) !== key,
      });
      if (!counts) return;
      st.counts = counts.slice();
      st.counts[st.index] = st.paginator.pages;
      st.countsKey = key;
      updateFolio();
      api.emit('folio');
    }, MEASURE_DELAY_MS);
  }

  function sentenceEls() {
    return el.content.querySelectorAll(st.lang === 'ru' ? '[data-rs]' : '[data-s]');
  }

  // Первое предложение, начинающееся на текущей странице (или продолжающееся с предыдущей).
  function firstVisibleSentence() {
    const list = sentenceEls();
    const p = st.paginator;
    let lo = 0;
    let hi = list.length - 1;
    let ans = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (p.pageOf(list[mid]) >= p.page) { ans = list[mid]; hi = mid - 1; } else lo = mid + 1;
    }
    if (ans && p.pageOf(ans) > p.page && lo > 0) return list[lo - 1];
    return ans || list[list.length - 1] || null;
  }

  function saveProgress() {
    if (!st.anchor) return;
    const meta = st.book.chapters[st.index];
    const key = st.lang === 'ru' ? 'rs' : 's';
    const rec = { chapterId: meta.id, lang: st.lang, ms: api.currentMs ? api.currentMs() : 0 };
    rec[st.lang === 'ru' ? 'rsId' : 'sentenceId'] = Number(st.anchor.dataset[key]);
    putProgress(st.book.id, rec);
  }

  // ---------- перелистывание («Сдвиг», как в Books) ----------
  const HIGHLIGHTS = ['s-on', 'w-on', 'c-on', 'c-first', 'c-last', 'w-sel', 'rs-flash'];

  function cloneContent() {
    const clone = el.content.cloneNode(true);
    for (const cls of HIGHLIGHTS) clone.querySelectorAll(`.${cls}`).forEach((n) => n.classList.remove(cls));
    return clone;
  }

  // Карточка — снимок всего экрана страницы: колонтитул, текст и номер страницы, как в Books.
  function screenCard(page, content) {
    const card = document.createElement('div');
    card.className = 'page-card';
    const head = el.runhead.cloneNode(true);
    const foot = el.folio.cloneNode(true);
    foot.textContent = folioText({
      mode: st.numbering, page, pages: st.paginator.pages, counts: st.counts, index: st.index,
    });
    const vp = document.createElement('div');
    vp.className = 'viewport';
    content.style.transition = 'none';
    content.style.transform = `translateX(${-page * st.paginator.step}px)`;
    vp.append(content);
    card.append(head, vp, foot);
    return card;
  }

  // Копия главы для карточек делается один раз и переиспользуется.
  function makeCard(page) {
    if (!st.cardClone) st.cardClone = cloneContent();
    return screenCard(page, st.cardClone);
  }

  function canTurnInChapter(dir) {
    const p = st.paginator;
    return dir > 0 ? p.page < p.pages - 1 : p.page > 0;
  }

  // Перелистывание внутри главы; управляется пальцем (set) или целиком (run).
  function beginPageSlide(dir) {
    const p = st.paginator;
    const from = p.page;
    const to = from + dir;
    const card = makeCard(dir > 0 ? from : to);
    if (dir > 0) {
      p.goTo(to); // под уезжающей карточкой уже лежит следующая страница
      updateFolio();
    }
    const slide = createSlide({ host: el.reader, card, dir });
    st.turning = true;
    return {
      slide,
      commit() {
        if (dir < 0) p.goTo(to);
        slide.remove();
        st.turning = false;
        showPage(to);
      },
      cancel() {
        if (dir > 0) { p.goTo(from); updateFolio(); }
        slide.remove();
        st.turning = false;
      },
    };
  }

  async function slideChapter(dir) {
    st.turning = true;
    try {
      if (dir > 0) {
        const card = makeCard(st.paginator.page);
        const slide = createSlide({ host: el.reader, card, dir: 1 });
        await openChapter(st.index + 1);
        await slide.run(1);
        slide.remove();
      } else {
        // текущая страница остаётся неподвижной под наезжающей предыдущей главой
        const under = screenCard(st.paginator.page, cloneContent());
        under.classList.add('under');
        el.reader.append(under);
        await openChapter(st.index - 1, { toEnd: true });
        const slide = createSlide({ host: el.reader, card: makeCard(st.paginator.page), under, dir: -1 });
        await slide.run(1);
        slide.remove();
      }
    } finally {
      st.turning = false;
    }
  }

  // Ручное перелистывание (тап, клавиши) — карточкой; панели при этом прячутся, как в Books.
  async function turn(dir) {
    if (st.loading || st.turning) return; // второй тап не должен перескочить через страницу
    setChrome(false);
    if (canTurnInChapter(dir)) {
      const t = beginPageSlide(dir);
      await t.slide.run(1);
      t.commit();
    } else if (dir > 0 ? st.index < st.book.chapters.length - 1 : st.index > 0) {
      await slideChapter(dir);
    }
    api.emit('manual-turn');
  }

  // Переход вслед за чтецом — простым сдвигом ленты, без карточки.
  function goPage(page) {
    if (st.turning || st.loading || page === st.paginator.page) return;
    if (Math.abs(page - st.paginator.page) === 1) {
      st.paginator.goTo(page, { animate: true });
      afterPageChange();
    } else {
      showPage(page);
    }
  }

  function relayout() {
    if (!st.paginator) return;
    st.cardClone = null;
    const anchor = api.relayoutAnchor ? api.relayoutAnchor() : st.anchor;
    st.paginator.spread = autoSpread();
    st.paginator.layout();
    if (anchor && anchor.isConnected) anchorPageAfterRelayout(st.paginator, anchor);
    st.counts = null;
    st.countsKey = null;
    showPage(st.paginator.page, false);
    scheduleMeasure();
  }

  // ---------- панели ----------
  function setChrome(on) {
    st.chrome = on;
    el.reader.classList.toggle('chrome-on', on);
    clearTimeout(st.hideTimer);
    if (on && api.isPlaying && api.isPlaying()) st.hideTimer = setTimeout(() => setChrome(false), CHROME_HIDE_MS);
  }

  function updateLangBtn() {
    for (const o of el.langBtn.querySelectorAll('.seg-opt')) o.classList.toggle('on', o.dataset.v === st.lang);
    el.langBtn.classList.toggle('disabled', !st.data.ru);
  }

  // Оглавление в духе Books: обложка, название, текущая страница; в строках — номер, название,
  // длительность аудио при текущей скорости и страница начала главы.
  function showToc() {
    const rate = (api.player && api.player.settings.rate) || 1;
    const starts = st.counts ? chapterStartPages(st.counts) : null;
    const pos = st.counts ? bookPosition(st.counts, st.index, st.paginator.page) : null;
    let n = 0;
    const rows = st.book.chapters.map((c, i) => {
      const num = c.kind === 'chapter' ? String(++n) : '';
      return h('li', {}, h('button', {
        class: `toc-row${i === st.index ? ' current' : ''}`,
        onclick: async () => { s.close(); await openChapter(i); api.emit('manual-turn'); },
      },
      h('span', { class: 'toc-num' }, num),
      h('span', { class: 'toc-title' }, st.lang === 'ru' && c.titleRu ? c.titleRu : c.title),
      h('span', { class: 'toc-dur' }, c.audio && c.durationMs ? formatDuration(c.durationMs, rate) : ''),
      h('span', { class: 'toc-page' }, starts ? String(starts[i]) : '')));
    });
    const coverUrl = st.book.cover ? URL.createObjectURL(st.book.cover) : null;
    const head = h('div', { class: 'toc-head' },
      coverUrl ? h('img', { class: 'toc-cover', src: coverUrl, alt: '' }) : null,
      h('div', { class: 'toc-meta' },
        h('div', { class: 'toc-book' }, st.book.title),
        h('div', { class: 'toc-where' }, pos ? `Страница ${pos.page} из ${pos.total}`
          : `Глава ${st.index + 1} из ${st.book.chapters.length}`)),
      h('button', { class: 'toc-close', 'aria-label': 'Закрыть', onclick: () => s.close() }, icon('close', 20)));
    const list = h('ol', { class: 'toc' }, rows);
    const s = sheet({ body: [head, list] });
    s.panel.classList.add('toc-sheet');
    s.panel.parentNode.classList.add('center');
    const cur = list.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
    if (coverUrl) setTimeout(() => URL.revokeObjectURL(coverUrl), 60000);
  }

  // ---------- жесты ----------
  function bindGestures() {
    // Полосы над и под текстом (колонтитулы) — тап показывает панели; тап по пустому месту
    // панели — прячет. Так меню открывается, не задевая слова и зоны листания.
    el.reader.addEventListener('click', (e) => {
      const t = e.target;
      if (t === el.reader || t === el.runhead || t === el.folio) {
        if (api.cardOpen && api.cardOpen()) api.emit('close-card');
        else setChrome(!st.chrome);
      } else if (t === el.top || t === el.bottom || t === el.left || t === el.center || t === el.right) {
        setChrome(false);
      }
    });
    let start = null;
    let drag = null; // null — ещё не решили, false — не перетаскивание, объект — страница едет за пальцем
    el.viewport.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target };
      drag = null;
      try { el.viewport.setPointerCapture(e.pointerId); } catch { /* нет захвата */ }
      api.emit('pointerdown', { event: e, start });
    });
    el.viewport.addEventListener('pointermove', (e) => {
      if (!start || drag === false) return;
      const dx = e.clientX - start.x;
      if (!drag) {
        const dy = e.clientY - start.y;
        if (Math.abs(dx) < DRAG_START_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        const dir = dx < 0 ? 1 : -1;
        if (st.loading || st.turning || !canTurnInChapter(dir) || (api.cardOpen && api.cardOpen())) {
          drag = false; // на границе главы — обычный свайп по отпусканию
          return;
        }
        setChrome(false);
        drag = { dir, turn: beginPageSlide(dir), lastX: e.clientX, lastT: e.timeStamp, v: 0 };
        api.emit('drag-start');
      }
      const dt = Math.max(1, e.timeStamp - drag.lastT);
      drag.v = ((e.clientX - drag.lastX) / dt) * (drag.dir > 0 ? -1 : 1);
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;
      drag.turn.slide.set(dragProgress(drag.dir, dx, el.viewport.clientWidth));
    });
    el.viewport.addEventListener('pointerup', async (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const s = start;
      start = null;
      if (drag) {
        const d = drag;
        drag = null;
        const done = shouldComplete(d.turn.slide.progress, d.v);
        await d.turn.slide.run(done ? 1 : 0);
        if (done) { d.turn.commit(); api.emit('manual-turn'); } else d.turn.cancel();
        return;
      }
      drag = null;
      if (api.consumeTap && api.consumeTap(s)) return;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
        await turn(dx < 0 ? 1 : -1);
        return;
      }
      const rect = el.viewport.getBoundingClientRect();
      const word = s.target.closest && s.target.closest('.w');
      const kind = classifyTap({
        x: e.clientX - rect.left, width: rect.width, onWord: Boolean(word), cardOpen: api.cardOpen ? api.cardOpen() : false,
      });
      if (kind === 'close-card') api.emit('close-card');
      else if (kind === 'word') api.emit('word', { el: word });
      else if (kind === 'prev') await turn(-1);
      else if (kind === 'next') await turn(1);
      else setChrome(!st.chrome);
    });
    el.viewport.addEventListener('pointercancel', async () => {
      start = null;
      if (drag) {
        const d = drag;
        drag = null;
        await d.turn.slide.run(0);
        d.turn.cancel();
      }
      drag = null;
    });
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'ArrowRight') turn(1);
    else if (e.key === 'ArrowLeft') turn(-1);
  }

  // ---------- API для других модулей экрана ----------
  const listeners = new Map();
  const api = {
    st,
    el,
    on(name, fn) { (listeners.get(name) || listeners.set(name, []).get(name)).push(fn); },
    emit(name, detail) { for (const fn of listeners.get(name) || []) fn(detail); },
    openChapter,
    showPage,
    goPage,
    setNumbering(mode) {
      st.numbering = mode === 'book' ? 'book' : 'chapter';
      if (st.paginator) updateFolio();
    },
    turn,
    relayout,
    setChrome,
    saveProgress,
    async toggleLang() {
      if (!st.data.ru) {
        sheet({ title: 'Перевода этой главы нет', actions: [{ label: 'Понятно' }] });
        return;
      }
      api.emit('lang', { to: st.lang === 'en' ? 'ru' : 'en' });
    },
    async setLang(lang, anchorOpts) {
      st.lang = lang;
      await openChapter(st.index, anchorOpts);
    },
  };

  return {
    api,
    async mount(root, [bookId]) {
      st.book = await getBook(bookId);
      if (!st.book || st.book.status !== 'ready') { go('#/library'); return; }
      build(root);
      const p = await getProgress(st.book.id);
      let index = 0;
      if (p) index = Math.max(0, st.book.chapters.findIndex((c) => c.id === p.chapterId));
      st.lang = (p && p.lang) || 'en';
      api.initialProgress = p || null;
      if (window.__syncbook) window.__syncbook.reader = api; // отладка на localhost
      for (const plugin of readerPlugins) await plugin(api);
      await openChapter(index, p ? { sentenceId: p.sentenceId ?? null, rsId: p.rsId ?? null } : {});
      api.emit('ready', { progress: p });
      st.resize = new ResizeObserver(() => relayout());
      st.resize.observe(el.viewport);
      setChrome(true);
    },
    async unmount() {
      saveProgress();
      api.emit('unmount');
      document.removeEventListener('keydown', onKey);
      if (st.resize) st.resize.disconnect();
      clearTimeout(st.hideTimer);
    },
  };
}

// Модули, расширяющие экран чтения (плеер, «Повтор», перевод, настройки) регистрируются здесь.
export const readerPlugins = [];
