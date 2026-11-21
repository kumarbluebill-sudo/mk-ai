/*
 * MK AI Travel service worker.
 *
 * It exists for two things only: installability and a friendly offline page.
 *
 * Privacy rule (this is a multi-agency app used on shared devices): NOTHING that belongs to a signed-in
 * user is ever stored. No /api responses, no HTML pages, no Next.js data. The only cached files are the
 * offline page and public, content-hashed static assets (JS/CSS/fonts/icons) that are identical for everyone.
 * Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const SHELL_CACHE = `mk-shell-${VERSION}`;
const ASSET_CACHE = `mk-assets-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL_CACHE, ASSET_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  // Next.js emits content-hashed files under /_next/static; icons are public and fixed.
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map tiles, Mapbox, fonts: never intercepted

  // Never touch API traffic or anything that could carry user data.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/data/")) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // Page navigations always go to the network. Only a failed network falls back to the offline page;
  // the page they asked for is never stored.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) ?? new Response("You are offline.", { status: 503, headers: { "content-type": "text/plain" } }))
    );
  }
});
