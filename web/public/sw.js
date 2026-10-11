/* WAGGLES_PWA1 — offline app-shell service worker.
 *
 * PRIVACY CONTRACT (read before changing anything here):
 *   This worker caches ONLY non-sensitive shell assets:
 *     - the static offline fallback page (/offline — carries no user data)
 *     - the PWA icons and the web manifest
 *     - Next's immutable build output under /_next/static/** (hashed JS/CSS)
 *   It NEVER caches: message content, keys, Supabase/API responses, React
 *   Server Component data payloads, or ANY navigation response. Navigations are
 *   network-first and, only when offline, fall back to the static /offline page.
 *   Non-GET requests and every cross-origin request (the Supabase backend a Bee
 *   points at) are passed straight through, untouched and uncached.
 *
 * basePath-aware: the app may be served under NEXT_PUBLIC_BASE_PATH, so all
 * paths are derived from the registration scope rather than hard-coded to "/".
 */

const VERSION = 'waggles-pwa-v1';
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');

const SHELL = [
  `${BASE}/offline`,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/icon-192.png`,
  `${BASE}/icon-512.png`,
  `${BASE}/icon-maskable-512.png`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never touch writes.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache cross-origin (the Supabase backend, any CDN) — message content
  // and auth live there. Let the network handle it directly.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the static offline page when
  // offline. The live navigation response is never written to the cache (a
  // conversation route could render message content).
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(`${BASE}/offline`)));
    return;
  }

  // Immutable build assets + our own shell assets: cache-first. These are
  // content-hashed static files and brand icons — no user data of any kind.
  const path = url.pathname;
  const cacheable = path.startsWith(`${BASE}/_next/static/`) || SHELL.includes(path);
  if (cacheable) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (RSC data, API routes, dynamic assets) — straight to the
  // network, never cached.
});
