// Номера страниц по всей книге: каждая глава вёрстается в скрытом окне с теми же размерами
// и настройками, результат кэшируется по ключу вёрстки. Плюс форматирование для колонтитула
// и оглавления.
import { getChapter } from './store.js';
import { renderEn, renderRu } from './render.js';
import { Paginator } from './paginator.js';

const cache = new Map();

export function chapterStartPages(counts) {
  const starts = [];
  let page = 1;
  for (const c of counts) {
    starts.push(page);
    page += c;
  }
  return starts;
}

export function bookPosition(counts, index, page) {
  const before = counts.slice(0, index).reduce((s, c) => s + c, 0);
  return { page: before + page + 1, total: counts.reduce((s, c) => s + c, 0) };
}

export function formatDuration(ms, rate = 1) {
  const min = Math.max(1, Math.round(ms / (rate || 1) / 60000));
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)} ч ${String(min % 60).padStart(2, '0')} мин`;
}

export function folioText({ mode, page, pages, counts, index }) {
  if (mode === 'book' && counts) {
    const p = bookPosition(counts, index, page);
    return `${p.page} из ${p.total}`;
  }
  return `${page + 1} из ${pages}`;
}

// Ключ вёрстки: при его смене номера страниц нужно пересчитать.
export function layoutKey(viewport, { lang, spread }) {
  const cs = getComputedStyle(document.documentElement);
  const vars = ['--book-font', '--book-size', '--book-leading', '--page-margin', '--book-align', '--book-hyphens']
    .map((v) => cs.getPropertyValue(v).trim());
  return [lang, spread, viewport.clientWidth, viewport.clientHeight, ...vars].join('|');
}

export function cachedCounts(bookId, key) {
  return cache.get(`${bookId}|${key}`) || null;
}

// Считает число страниц каждой главы. isStale() — прервать, если вёрстка уже изменилась.
export async function measureBook({ book, lang, spread, viewport, host, key, isStale = () => false }) {
  const full = `${book.id}|${key}`;
  if (cache.has(full)) return cache.get(full);
  const vp = document.createElement('div');
  vp.className = 'viewport';
  Object.assign(vp.style, {
    visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0', right: 'auto', bottom: 'auto',
    width: `${viewport.clientWidth}px`, height: `${viewport.clientHeight}px`,
  });
  const content = document.createElement('div');
  content.className = 'content';
  vp.append(content);
  host.append(vp);
  const counts = [];
  try {
    for (const meta of book.chapters) {
      if (isStale()) return null;
      const data = await getChapter(book.id, meta.id);
      const body = lang === 'ru' && data.ru ? renderRu(data.ru) : renderEn(data.en);
      content.replaceChildren(...body.childNodes);
      counts.push(new Paginator(vp, content, { spread }).layout());
      await new Promise((r) => setTimeout(r, 0)); // не блокировать интерфейс
    }
  } finally {
    vp.remove();
  }
  cache.set(full, counts);
  return counts;
}
