// Service worker: guarda la app para que funcione sin internet.
// Tus entradas NUNCA pasan por aquí: viven en IndexedDB de tu teléfono.
const VERSION = 'diario-v2.0.0';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './zip.js', './content.js', './wellbeing.js',
  './manifest.webmanifest', './fonts/NotoSans-latin.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png'
];
self.addEventListener('install', e => {
  // cache: 'reload' evita que el navegador entregue archivos viejos de su caché HTTP.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(cache => cache.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    }))
  );
});
