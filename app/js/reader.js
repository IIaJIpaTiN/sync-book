// Экран чтения: глава постранично, панели, листание тапом и свайпом, оглавление, переход между главами.
import { getBook, getChapter, getProgress, putProgress } from './store.js';
import { renderEn, renderRu } from './render.js';
import { Paginator, autoSpread, anchorPageAfterRelayout } from './paginator.js';
import { classifyTap } from './taps.js';
import { go } from './main.js';
import { h, sheet } from './ui.js';
import { icon } from './icons.js';

const SWIPE_PX = 40;
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
    el.controls = h('div', { class: 'controls' });
    el.pageinfo = h('div', { class: 'pageinfo' });
    el.bottom = h('footer', { class: 'bar bottom' }, el.controls, el.pageinfo);
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
    showPage(target, false);
    api.emit('chapter', { index: st.index, meta });
  }

  function showPage(page, animate = true) {
    st.paginator.goTo(page, { animate });
    st.anchor = firstVisibleSentence();
    const n = st.paginator.pages;
    const text = `${st.paginator.page + 1} из ${n}`;
    el.folio.textContent = text;
    el.pageinfo.textContent = `стр. ${text}`;
    saveProgress();
    api.emit('page', { page: st.paginator.page });
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

  async function turn(dir) {
    if (st.loading) return; // глава ещё грузится — второй свайп не должен перескочить через неё
    const p = st.paginator;
    if (dir > 0) {
      if (p.page < p.pages - 1) showPage(p.page + 1);
      else if (st.index < st.book.chapters.length - 1) await openChapter(st.index + 1);
    } else if (p.page > 0) showPage(p.page - 1);
    else if (st.index > 0) await openChapter(st.index - 1, { toEnd: true });
    api.emit('manual-turn');
  }

  function relayout() {
    if (!st.paginator) return;
    const anchor = (api.relayoutAnchor && api.relayoutAnchor()) || st.anchor;
    st.paginator.spread = autoSpread();
    st.paginator.layout();
    if (anchor && anchor.isConnected) anchorPageAfterRelayout(st.paginator, anchor);
    showPage(st.paginator.page, false);
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

  function showToc() {
    const list = h('ol', { class: 'toc' }, st.book.chapters.map((c, i) => h('li', {},
      h('button', {
        class: `toc-item${i === st.index ? ' current' : ''}`,
        onclick: async () => { s.close(); await openChapter(i); api.emit('manual-turn'); },
      }, st.lang === 'ru' && c.titleRu ? c.titleRu : c.title))));
    const s = sheet({ title: st.book.title, body: [list] });
    s.panel.classList.add('toc-sheet');
    const cur = list.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }

  // ---------- жесты ----------
  function bindGestures() {
    let start = null;
    el.viewport.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target };
      api.emit('pointerdown', { event: e, start });
    });
    el.viewport.addEventListener('pointerup', async (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const s = start;
      start = null;
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
    el.viewport.addEventListener('pointercancel', () => { start = null; });
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
