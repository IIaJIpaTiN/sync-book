// Онлайн-перевод: бесплатный эндпоинт Google Translate, при ошибке — MyMemory.
const TIMEOUT_MS = 8000;

async function withTimeout(fetchImpl, url, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const providers = [
  async (text, from, to, f, signal) => {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    const json = await withTimeout(f, url, signal);
    return json[0].map((x) => x[0]).join('');
  },
  async (text, from, to, f, signal) => {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const json = await withTimeout(f, url, signal);
    return json.responseData.translatedText;
  },
];

export async function translate(text, from = 'en', to = 'ru', { signal, fetchImpl = fetch, online = navigator.onLine } = {}) {
  if (!online) throw new Error('offline');
  let last;
  for (const p of providers) {
    try {
      const out = await p(text, from, to, fetchImpl, signal);
      if (out) return out;
    } catch (err) {
      last = err;
      if (signal && signal.aborted) throw err;
    }
  }
  throw last || new Error('Перевод недоступен');
}
