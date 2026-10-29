// Хранилище: IndexedDB (книги, главы, словарь, прогресс, настройки) и OPFS (аудио глав).

const DB_NAME = 'syncbook';
const DB_VERSION = 1;
let dbPromise = null;

export function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('books', { keyPath: 'id' });
        d.createObjectStore('chapters');
        d.createObjectStore('dicts');
        d.createObjectStore('progress');
        d.createObjectStore('settings');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function op(storeName, mode, fn) {
  const d = await db();
  const t = d.transaction(storeName, mode);
  const result = await done(fn(t.objectStore(storeName)));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

const chapterRange = (bookId) => IDBKeyRange.bound([bookId, ''], [bookId, '￿']);

export const putBook = (rec) => op('books', 'readwrite', (s) => s.put(rec));
export const getBook = (id) => op('books', 'readonly', (s) => s.get(id));
export const getBooks = () => op('books', 'readonly', (s) => s.getAll());
export const putChapter = (bookId, chId, data) => op('chapters', 'readwrite', (s) => s.put(data, [bookId, chId]));
export const getChapter = (bookId, chId) => op('chapters', 'readonly', (s) => s.get([bookId, chId]));
export const putDict = (bookId, dict) => op('dicts', 'readwrite', (s) => s.put(dict, bookId));
export const getDict = (bookId) => op('dicts', 'readonly', (s) => s.get(bookId));
export const putProgress = (bookId, p) => op('progress', 'readwrite', (s) => s.put({ ...p, updatedAt: Date.now() }, bookId));
export const getProgress = (bookId) => op('progress', 'readonly', (s) => s.get(bookId));
export const putSettings = (s) => op('settings', 'readwrite', (st) => st.put(s, 'global'));
export const getSettings = () => op('settings', 'readonly', (s) => s.get('global'));

export async function deleteBook(id, { keepProgress = false } = {}) {
  await op('books', 'readwrite', (s) => s.delete(id));
  await op('chapters', 'readwrite', (s) => s.delete(chapterRange(id)));
  await op('dicts', 'readwrite', (s) => s.delete(id));
  if (!keepProgress) await op('progress', 'readwrite', (s) => s.delete(id));
  try {
    const books = await booksDir();
    await books.removeEntry(id, { recursive: true });
  } catch (err) {
    if (err.name !== 'NotFoundError') throw err;
  }
}

// ---------- OPFS ----------

async function booksDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('books', { create: true });
}

async function audioDir(bookId, create) {
  const books = await booksDir();
  const book = await books.getDirectoryHandle(bookId, { create });
  return book.getDirectoryHandle('audio', { create });
}

const CHUNK = 8 * 1024 * 1024;

export async function writeAudio(bookId, name, blob, onBytes = () => {}) {
  const dir = await audioDir(bookId, true);
  const handle = await dir.getFileHandle(name, { create: true });
  if ('createWritable' in handle) {
    const w = await handle.createWritable();
    for (let pos = 0; pos < blob.size; pos += CHUNK) {
      const part = blob.slice(pos, pos + CHUNK);
      await w.write(await part.arrayBuffer());
      onBytes(part.size);
    }
    await w.close();
  } else {
    await writeViaWorker(bookId, name, blob, onBytes);
  }
}

// Safari без createWritable: запись через createSyncAccessHandle в воркере.
export function writeViaWorker(bookId, name, blob, onBytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./opfs-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      if (e.data.bytes) onBytes(e.data.bytes);
      if (e.data.done) { worker.terminate(); resolve(); }
      if (e.data.error) { worker.terminate(); reject(new Error(e.data.error)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message)); };
    worker.postMessage({ path: ['books', bookId, 'audio', name], blob, chunk: CHUNK });
  });
}

export async function audioFile(bookId, name) {
  try {
    const dir = await audioDir(bookId, false);
    return await (await dir.getFileHandle(name)).getFile();
  } catch (err) {
    if (err.name === 'NotFoundError' || err.name === 'TypeError') return null;
    throw err;
  }
}

export const audioName = (path) => path.split('/').pop();

export async function hasAllAudio(book) {
  for (const ch of book.chapters) {
    if (ch.audio && !(await audioFile(book.id, audioName(ch.audio)))) return false;
  }
  return true;
}
