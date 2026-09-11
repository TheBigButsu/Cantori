/* Cantori — offline service worker.
   ----------------------------------------------------------------------------
   The whole point of this file is a flight: open the game once with a signal,
   then play it at 30,000 feet with the radio off. It keeps a copy of the site —
   the page, the scripts, the styles, the icons and every sprite — and serves the
   game out of that copy whenever the network isn't there.

   Two rules shape everything below.

   1. NOTHING HERE IS VERSIONED BY HAND. index.html and editor.html already carry
      a ?v= cache-buster on every script and stylesheet (CLAUDE.md rule 4), and a
      third place to remember to bump is a bug with a date on it. So this worker
      precaches no fixed list: offline.js reads the URLs out of the live document
      — ?v= and all — and posts them here. A version bump therefore cannot leave
      the worker hoarding last month's files, because it never knew their names.

   2. THE DOCUMENTS ARE NETWORK-FIRST. A stale editor is the most expensive bug
      this repo has had: editor.html sat on a cached data.js for eight
      generations, and "Commit data.js" rewrites the file wholesale, so every
      save silently reverted everything that had landed since. Serving an .html
      out of cache while a network is available would rebuild that trap from the
      other side. The network wins whenever it answers; the cache is a parachute,
      not a shortcut. Everything those documents then pull in is addressed by a
      ?v= URL that changes when the file does, so cache-first is safe there.
   ========================================================================== */
"use strict";

const CACHE = "cantori";
const HERE = (p) => new URL(p, self.location.href).href;

// Nothing is precached at install — this worker doesn't know what ?v= today's
// page is on until a page tells it. Taking over straight away is what matters:
// on a first visit the page is already running uncontrolled, and skipWaiting +
// claim let the warm-up start now instead of on the next reload, which on the
// way to an airport is the difference between saved and not.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// ---- serving ---------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // GitHub's API, and anything else, is not ours to cache

  // The editor re-fetches data.js with cache:"no-store" for the express purpose
  // of finding out what the SERVER has. Answering that from a cache would defeat
  // the only check standing between a stale draft and a wholesale overwrite, so
  // these go straight to the network — and offline they fail, which is the
  // honest answer and the one the editor already handles.
  if (req.cache === "no-store" || req.cache === "reload") return;

  const doc = req.mode === "navigate" || url.pathname.endsWith(".html");
  event.respondWith(doc ? networkFirst(event, req) : cacheFirst(event, req));
});

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) event.waitUntil(cache.put(req, res.clone()));
    return res;
  } catch (e) {
    // ignoreSearch: a launch from the home screen or a shared link can arrive
    // with a query the cached copy never had, and it addresses the same page.
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // "./" and "./index.html" address the same page but are two cache entries,
    // and which one got saved depends on how the first visit was spelled. Either
    // answers for the game — but only for the game: handing index.html to
    // someone who asked for editor.html would silently give them the wrong app.
    if (req.mode === "navigate" && !new URL(req.url).pathname.endsWith("editor.html")) {
      for (const shell of [HERE("./index.html"), HERE("./")]) {
        const idx = await cache.match(shell, { ignoreSearch: true });
        if (idx) return idx;
      }
    }
    return notSaved();
  }
}

async function cacheFirst(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);

  // A ?v= URL is its own version stamp: the file it names cannot change without
  // the URL changing too, so a hit is final and re-asking is pure waste on a
  // phone connection. Sprites and icons carry no ?v= at all — rule 3 ships a
  // sprite with its data row, so replaced art keeps its URL forever — and those
  // we serve from cache but refresh behind the reader's back, so the next load
  // shows the new tile. Offline the refresh just fails, quietly.
  if (hit && new URL(req.url).search) return hit;

  const fresh = fetch(req).then((res) => {
    if (res && res.ok) return cache.put(req, res.clone()).then(() => res);
    return res;
  }).catch(() => null);

  if (hit) { event.waitUntil(fresh); return hit; }
  return (await fresh) || new Response("", { status: 504, statusText: "offline" });
}

function notSaved() {
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
    "<title>Cantori — not saved</title>" +
    "<body style='margin:0;display:grid;place-items:center;height:100vh;background:#0e0b07;color:#ece2cf;" +
    "font:14px ui-monospace,Menlo,Consolas,monospace;text-align:center'>" +
    "<div style='max-width:22em;padding:24px'><p style='color:#f0a838;letter-spacing:.28em;font-weight:700'>CANTORI</p>" +
    "<p>This page isn't saved for offline yet.</p>" +
    "<p style='color:#8a7c63'>Open it once with a connection and it will keep itself for the next flight.</p></div>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// ---- warming ---------------------------------------------------------------
// A page hands over the exact URL list it is running on; we make sure every one
// of them is in the cache and report how far along we are, so the badge can tell
// the reader whether the game is actually safe to take on a plane. Guessing is
// the one thing that would make the badge worse than no badge at all.
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "warm") return;
  event.waitUntil(warm(msg.urls || [], event.ports && event.ports[0]));
});

async function warm(urls, port) {
  const cache = await caches.open(CACHE);
  const wanted = [...new Set(urls)];
  let done = 0, missing = 0;
  const post = (type) => { if (port) port.postMessage({ type, done, total: wanted.length, missing }); };
  post("progress");

  // Six at a time. One at a time makes ~95 round trips feel like a download, and
  // all at once buries the game's own sprite requests on a phone connection.
  const queue = wanted.slice();
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      if (!(await cache.match(url))) {
        try {
          const res = await fetch(url);
          if (res && res.ok) await cache.put(url, res.clone()); else missing++;
        } catch (e) { missing++; }
      }
      done++;
      post("progress");
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));

  // Only prune after a clean sweep. A warm that half-failed (a flaky connection
  // in a departure lounge) must never be the reason a game you already saved
  // gets evicted.
  if (!missing) await prune(cache, wanted);
  post("done");
}

// Drop the PREVIOUS version's files, and nothing else. Everything a page names
// is addressed <path>?v=<n>, so a cached entry sharing a path with a wanted URL
// but carrying a different query is last version's copy by definition. Entries
// on paths this page never mentioned — the other page's files — are left alone.
async function prune(cache, wanted) {
  const paths = new Set(wanted.map((u) => new URL(u).pathname));
  const keep = new Set(wanted);
  for (const req of await cache.keys()) {
    const u = new URL(req.url);
    if (paths.has(u.pathname) && !keep.has(u.href)) await cache.delete(req);
  }
}
