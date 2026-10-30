// Экран библиотеки: полка с обложками, импорт .syncbook, удаление книги.
import { getBooks, getProgress, deleteBook, hasAllAudio } from './store.js';
import { importSyncbook } from './importer.js';
import { go } from './main.js';
import { h, sheet } from './ui.js';
import { icon } from './icons.js';

const LONG_PRESS_MS = 600;

export function libraryScreen() {
  let root = null;
  const urls = [];

  async function render() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const books = (await getBooks()).filter((b) => b.status === 'ready')
      .sort((a, b) => b.importedAt - a.importedAt);
    const fileInput = h('input', { type: 'file', accept: '.syncbook', hidden: true, onchange: onFile });
    const importBtn = h('button', { class: 'lib-import', 'aria-label': 'Добавить книгу', onclick: () => fileInput.click() }, icon('plus', 26));
    const header = h('header', { class: 'lib-head' }, h('h1', {}, 'Библиотека'), importBtn, fileInput);
    let body;
    if (!books.length) {
      body = h('section', { class: 'lib-empty' },
        h('h2', {}, 'Добавьте первую книгу'),
        h('p', {}, 'Соберите книгу на компьютере в файл .syncbook, перенесите его на iPad и откройте здесь через «Файлы».'),
        h('button', { class: 'pill', onclick: () => fileInput.click() }, 'Импорт'));
    } else {
      body = h('section', { class: 'lib-grid' });
      for (const b of books) body.append(await tile(b));
    }
    root.replaceChildren(h('main', { class: 'library' }, header, body));
  }

  async function tile(book) {
    const p = await getProgress(book.id);
    const n = book.chapters.length;
    const idx = p ? Math.max(0, book.chapters.findIndex((c) => c.id === p.chapterId)) : -1;
    const percent = p ? Math.round(((idx + 0.5) / n) * 100) : 0;
    const complete = await hasAllAudio(book);
    let cover;
    if (book.cover) {
      const url = URL.createObjectURL(book.cover);
      urls.push(url);
      cover = h('img', { class: 'cover', src: url, alt: '' });
    } else {
      cover = h('div', { class: 'cover cover-plain' }, h('span', {}, book.title));
    }
    const el = h('button', { class: 'book', 'aria-label': book.title },
      h('div', { class: 'cover-wrap' }, cover),
      h('div', { class: 'book-title' }, book.title),
      h('div', { class: 'book-meta' }, complete ? (p ? `${percent} %` : 'Новая') : 'Нужен повторный импорт'));
    let timer = null;
    let long = false;
    const cancel = () => clearTimeout(timer);
    el.addEventListener('pointerdown', () => {
      long = false;
      timer = setTimeout(() => { long = true; askDelete(book); }, LONG_PRESS_MS);
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      if (long) return;
      if (complete) go(`#/read/${encodeURIComponent(book.id)}`);
      else showImport(null, `«${book.title}» нужно импортировать заново: файлы книги были удалены системой.`);
    });
    return el;
  }

  function askDelete(book) {
    sheet({
      title: book.title,
      text: 'Книга и её аудио будут удалены с этого iPad. Позиция чтения сохранится.',
      actions: [
        { label: 'Удалить книгу', danger: true, run: async () => { await deleteBook(book.id, { keepProgress: true }); render(); } },
        { label: 'Отмена' },
      ],
    });
  }

  function showImport(file, message) {
    const bar = h('div', { class: 'progress-fill' });
    const status = h('p', { class: 'sheet-text' }, message || 'Подготовка…');
    const s = sheet({ title: file ? file.name.replace(/\.syncbook$/, '') : 'Импорт', body: [status, h('div', { class: 'progress' }, bar)], actions: [{ label: 'Закрыть' }] });
    return { s, bar, status };
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const { s, bar, status } = showImport(file);
    try {
      await importSyncbook(file, (f) => {
        bar.style.transform = `scaleX(${f})`;
        status.textContent = `Импорт… ${Math.round(f * 100)} %`;
      });
      s.close();
      render();
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  }

  return {
    async mount(el) {
      root = el;
      await render();
    },
    unmount() {
      urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    },
  };
}
