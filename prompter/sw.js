// Offline support: after the first visit the prompter, speech library and
// model load from this device, so a bad Wi-Fi day doesn't stop a recording.
const CACHE = "rgn-prompter-v10";
const CORE = [
  "./", "index.html", "css/prompter.css",
  "js/app.js", "js/text.js", "js/align.js", "js/motion.js", "js/render.js", "js/engines.js",
  "js/editor.js", "js/segments.js", "js/board.js", "js/board-panel.js", "js/store.js",
  "vendor/vosk.js",
];
const MODEL = "models/vosk-model-small-en-us-0.15.tar.gz";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // The page and code: network first so updates show up, cache when offline.
  // The model: cache first (it never changes and is 40 MB).
  const isModel = url.pathname.endsWith(MODEL);
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isModel) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone()).catch(() => {});
      return res;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      throw err;
    }
  })());
});
