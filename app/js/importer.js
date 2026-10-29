// Импорт пакета .syncbook: ZIP без сжатия → IndexedDB (тексты, словарь) + OPFS (аудио).
import { readZipIndex, entryBlob } from './zip.js';
import {
  getBook, getBooks, putBook, putChapter, putDict, deleteBook, writeAudio, audioName,
} from './store.js';

export class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const FORMAT = 1;
const MB = 1024 * 1024;

async function readJson(blob, idx, name) {
  const e = idx.get(name);
  if (!e) throw new ImportError('corrupt', `Файл повреждён: нет ${name}. Соберите книгу заново`);
  try {
    return JSON.parse(await entryBlob(blob, e).text());
  } catch {
    throw new ImportError('corrupt', `Файл повреждён: не читается ${name}. Соберите книгу заново`);
  }
}

export async function importSyncbook(blob, onProgress = () => {}) {
  let idx;
  try {
    idx = await readZipIndex(blob);
  } catch (err) {
    const code = err.code === 'compressed' || err.code === 'zip64' ? 'format' : 'corrupt';
    throw new ImportError(code, code === 'format'
      ? 'Этот файл не подходит: архив должен быть без сжатия'
      : 'Файл повреждён. Соберите книгу заново');
  }
  const m = await readJson(blob, idx, 'manifest.json');
  if (m.format !== FORMAT) {
    throw new ImportError('format', `Этот файл не подходит: версия формата ${m.format}`);
  }

  const total = [...idx.values()].reduce((s, e) => s + e.size, 0);
  if (navigator.storage && navigator.storage.estimate) {
    const { quota = Infinity, usage = 0 } = await navigator.storage.estimate();
    const need = total * 1.1 - (quota - usage);
    if (need > 0) throw new ImportError('space', `Не хватает места: нужно ещё ${Math.ceil(need / MB)} МБ`);
  }
  if (navigator.storage && navigator.storage.persist) await navigator.storage.persist().catch(() => {});

  const previous = await getBook(m.id);
  if (previous) await deleteBook(m.id, { keepProgress: true });

  const coverEntry = m.cover && idx.get(m.cover);
  const cover = coverEntry
    ? new Blob([await entryBlob(blob, coverEntry).arrayBuffer()], { type: 'image/jpeg' })
    : null;
  const rec = {
    id: m.id,
    title: m.title,
    titleRu: m.titleRu || '',
    author: m.author || '',
    narrator: m.narrator || '',
    cover,
    chapters: m.chapters,
    status: 'importing',
    importedAt: Date.now(),
    bytes: total,
  };
  await putBook(rec);

  let doneBytes = 0;
  const step = (n) => {
    doneBytes += n;
    onProgress(Math.min(doneBytes / total, 0.999));
  };
  try {
    for (const ch of m.chapters) {
      const en = await readJson(blob, idx, ch.text);
      const ru = ch.ru ? await readJson(blob, idx, ch.ru) : null;
      await putChapter(m.id, ch.id, { en, ru });
      step(idx.get(ch.text).size + (ch.ru ? idx.get(ch.ru).size : 0));
    }
    await putDict(m.id, await readJson(blob, idx, m.dict || 'dict.json'));
    for (const ch of m.chapters) {
      if (!ch.audio) continue;
      const e = idx.get(ch.audio);
      if (!e) throw new ImportError('corrupt', `Файл повреждён: нет ${ch.audio}. Соберите книгу заново`);
      await writeAudio(m.id, audioName(ch.audio), entryBlob(blob, e), step);
    }
    rec.status = 'ready';
    await putBook(rec);
    onProgress(1);
    return rec;
  } catch (err) {
    await deleteBook(m.id, { keepProgress: Boolean(previous) });
    if (err instanceof ImportError) throw err;
    throw new ImportError('corrupt', `Файл повреждён. Соберите книгу заново (${err.message})`);
  }
}

export async function cleanupIncomplete() {
  const half = (await getBooks()).filter((b) => b.status === 'importing');
  for (const b of half) await deleteBook(b.id, { keepProgress: true });
  return half.length;
}

if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.__syncbook = {
    async importFromUrl(url, onProgress) {
      return importSyncbook(await (await fetch(url)).blob(), onProgress);
    },
  };
}
