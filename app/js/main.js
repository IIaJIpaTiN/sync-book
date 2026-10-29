// Точка входа: роутер экранов по location.hash и регистрация Service Worker.
// Экран — объект { mount(root, params), unmount() }.

const screens = new Map();
let current = null;

export function registerScreen(name, factory) {
  screens.set(name, factory);
}

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function parse() {
  const [name = 'library', ...params] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name, params: params.map(decodeURIComponent) };
}

async function route() {
  const { name, params } = parse();
  const factory = screens.get(name) || screens.get('library');
  if (current) await current.unmount();
  document.querySelectorAll('.backdrop').forEach((b) => b.remove());
  const root = document.getElementById('app');
  root.replaceChildren();
  current = factory ? factory() : null;
  if (current) await current.mount(root, params);
}

async function start() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW:', err));
  }
  const { cleanupIncomplete } = await import('./importer.js');
  await cleanupIncomplete();
  const { libraryScreen } = await import('./library.js');
  registerScreen('library', libraryScreen);
  const { readerScreen, readerPlugins } = await import('./reader.js');
  const { attachPlayer } = await import('./reader-player.js');
  const { attachRepeat } = await import('./reader-repeat.js');
  const { attachLang } = await import('./reader-lang.js');
  readerPlugins.push(attachPlayer, attachRepeat, attachLang);
  registerScreen('read', readerScreen);
  window.addEventListener('hashchange', route);
  await route();
}

start();
