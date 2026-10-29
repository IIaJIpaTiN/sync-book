// Service Worker: офлайн-кэш оболочки приложения. Увеличивайте APP_VERSION при каждом изменении файлов app/.
const APP_VERSION = 13;
const CACHE = `syncbook-v${APP_VERSION}`;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/fonts.css',
  'css/tokens.css',
  'css/library.css',
  'css/reader.css',
  'css/sheet.css',
  'js/main.js',
  'js/zip.js',
  'js/store.js',
  'js/opfs-worker.js',
  'js/importer.js',
  'js/ui.js',
  'js/taps.js',
  'js/library.js',
  'js/icons.js',
  'js/render.js',
  'js/paginator.js',
  'js/reader.js',
  'js/timeline.js',
  'js/player.js',
  'js/sync.js',
  'js/reader-player.js',
  'js/repeat.js',
  'js/reader-repeat.js',
  'js/bilingual.js',
  'js/reader-lang.js',
  'js/dict.js',
  'js/online.js',
  'js/cards.js',
  'js/reader-translate.js',
  'js/settings.js',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/literata-normal-latin.woff2',
  'fonts/literata-normal-latin-ext.woff2',
  'fonts/literata-normal-cyrillic.woff2',
  'fonts/literata-italic-latin.woff2',
  'fonts/literata-italic-latin-ext.woff2',
  'fonts/literata-italic-cyrillic.woff2',
];
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (DEV) {
    // при разработке — сначала сеть, кэш только как запасной вариант
    e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)),
  );
});
