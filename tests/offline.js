#!/usr/bin/env node
/* Cantori offline test.
 *
 * Proves the one promise sw.js makes: load the game once with a connection, and
 * it plays with the connection gone. Everything here is the flight, in order —
 * visit online, pull the plug, reload, and check the game actually came up with
 * its sprites rather than a browser error page.
 *
 * It also pins the two cache strategies, because getting them backwards is
 * silent and expensive:
 *   - documents are network-first (a cached editor.html is how this repo lost
 *     months of content edits once already — see sw.js),
 *   - ?v= assets are cache-first and are NOT re-fetched on a repeat visit.
 *
 * Usage:  node tests/offline.js [--headed]
 *
 * Needs Playwright, resolved the same way tests/smoke.js resolves it: this repo
 * has no dependencies and no build step.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");
const HEADED = process.argv.includes("--headed");

function loadChromium() {
  try {
    return require("playwright").chromium;
  } catch (e) { /* fall through to the global install */ }
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(path.join(globalRoot, "index.js"))("playwright").chromium;
  } catch (e) { /* fall through to the error below */ }
  console.error(
    "Playwright not found.\n" +
    "  Install it locally:  npm i -D playwright && npx playwright install chromium\n" +
    "  ...or globally:      npm i -g playwright"
  );
  process.exit(2);
}

// ---- a tiny static server that counts what it served ------------------------
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".md": "text/plain",
};

function serve(hits, fail) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      hits.set(url, (hits.get(url) || 0) + 1);
      if (fail.has(url)) { res.writeHead(500); res.end("the departure lounge wifi"); return; }
      const rel = path.normalize(url === "/" ? "/index.html" : url).replace(/^(\.\.[/\\])+/, "");
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      // No-store so the BROWSER cache can never be the thing that makes this
      // test pass: whatever survives the offline reload survived in the service
      // worker's cache, which is the only one that will be there at altitude.
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

// ---- reporting -------------------------------------------------------------
const failures = [];
let checks = 0;
function check(ok, message) {
  checks++;
  if (!ok) failures.push(message);
  return ok;
}

async function main() {
  const chromium = loadChromium();
  const hits = new Map();
  const fail = new Set();
  const { server, port } = await serve(hits, fail);
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({ viewport: { width: 430, height: 930 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (err) => errors.push("uncaught: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push("console: " + msg.text());
  });

  // ---- 1. the visit before the flight --------------------------------------
  await page.goto(`${origin}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.cantoriOffline && window.cantoriOffline.state === "ready",
    null, { timeout: 60000 }).catch(() => {});

  const warm = await page.evaluate(() => window.cantoriOffline);
  check(warm && warm.state === "ready", `offline save never reported ready (state: ${warm && warm.state})`);
  check(warm && warm.missing === 0, `${warm && warm.missing} file(s) failed to save for offline`);

  // Every sprite the content asks for has to be in that list, or a monster you
  // meet for the first time at 30,000 feet renders blank.
  const sprites = await page.evaluate(() => window.cantori.spriteUrls().length);
  check(warm.total > sprites, `offline list (${warm.total}) doesn't cover the ${sprites} sprites plus the page`);

  // ---- 2. a repeat visit, still online: strategies ------------------------
  const before = new Map(hits);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.cantoriOffline && window.cantoriOffline.state === "ready",
    null, { timeout: 60000 }).catch(() => {});
  const since = (p) => (hits.get(p) || 0) - (before.get(p) || 0);

  check(since("/index.html") > 0, "index.html was served from cache while online — documents must be network-first");
  check(since("/game.js") === 0, "game.js was re-fetched though its ?v= URL hadn't changed");
  check(since("/data.js") === 0, "data.js was re-fetched though its ?v= URL hadn't changed");

  // ---- 3. wheels up --------------------------------------------------------
  await context.setOffline(true);
  errors.length = 0;
  // The reload itself is the test: with no worker answering, the browser never
  // navigates at all, so catch that and report it as the failure it is rather
  // than letting an ERR_INTERNET_DISCONNECTED stack trace stand in for one.
  const navigated = await page.reload({ waitUntil: "load" }).then(() => true).catch(() => false);
  check(navigated, "the page didn't even load offline — nothing was saved to serve it");

  const booted = navigated && await page.waitForFunction(() => window.cantori && window.CANTORI_DATA, null, { timeout: 20000 })
    .then(() => true).catch(() => false);
  check(booted, "the game did not boot with the network gone");

  if (booted) {
    // The class-select overlay is the first thing a run shows; getting past it
    // offline is the difference between "the page loaded" and "the game runs".
    const plays = await page.evaluate(() => {
      const roster = window.cantori.classRoster();
      window.cantori.pickClass(roster[0]);
      const s = window.cantori.peek();
      return !!(s && s.mlist);
    }).catch((e) => "threw: " + e.message);
    check(plays === true, `could not start a run offline (${plays})`);

    // Served through the worker, with nothing behind it but the cache.
    const gone = await page.evaluate(async () => {
      const out = [];
      // "./" is the manifest's start_url — what a home-screen launch asks for,
      // and a different cache entry from index.html.
      for (const u of window.cantori.spriteUrls().concat(["./"])) {
        const ok = await fetch(u).then((r) => r.ok).catch(() => false);
        if (!ok) out.push(u);
      }
      return out;
    });
    check(gone.length === 0, `unreachable offline: ${gone.slice(0, 5).join(", ")}${gone.length > 5 ? ` (+${gone.length - 5} more)` : ""}`);
  }

  check(errors.length === 0, `console errors offline:\n  - ${errors.slice(0, 5).join("\n  - ")}`);

  // ---- 4. the home-screen launch ------------------------------------------
  // A phone that installed the game opens the manifest's start_url — the bare
  // directory — not index.html, and the two are separate cache entries. A first
  // visit spelled either way has to answer for both, or the icon on the home
  // screen opens a browser error at cruising altitude.
  const home = await context.newPage();
  const homeErrors = [];
  home.on("pageerror", (err) => homeErrors.push("uncaught: " + err.message));
  const homeNavigated = await home.goto(`${origin}/`, { waitUntil: "load" }).then(() => true).catch(() => false);
  check(homeNavigated, "the manifest start_url ('/') didn't load offline");
  if (homeNavigated) {
    const homeBooted = await home.waitForFunction(() => window.cantori && window.CANTORI_DATA, null, { timeout: 20000 })
      .then(() => true).catch(() => false);
    check(homeBooted, "the game didn't boot offline from the home-screen start_url");
  }
  check(homeErrors.length === 0, `console errors on the offline home-screen launch: ${homeErrors.slice(0, 3).join("; ")}`);
  await home.close();

  // ---- 5. the editor, same deal -------------------------------------------
  await context.setOffline(false);
  const ed = await context.newPage();
  await ed.goto(`${origin}/editor.html`, { waitUntil: "load" });
  await ed.waitForFunction(() => window.cantoriOffline && window.cantoriOffline.state === "ready",
    null, { timeout: 60000 }).catch(() => {});
  await context.setOffline(true);
  const edNavigated = await ed.reload({ waitUntil: "load" }).then(() => true).catch(() => false);
  const edOk = edNavigated && await ed.evaluate(() => !!document.querySelector("body")).catch(() => false);
  const edTitle = await ed.title().catch(() => "");
  check(edOk && !/not saved/i.test(edTitle), `the editor did not come up offline (title: ${edTitle})`);

  // The game must still be the game — warming from the editor must not have
  // pruned it, and editor.html must not answer for index.html.
  const stillThere = edNavigated && await ed.evaluate(async () => {
    const res = await fetch("./").catch(() => null);
    if (!res || !res.ok) return false;
    const html = await res.text();
    const src = (html.match(/src="(\.\/game\.js\?v=\d+)"/) || [])[1];
    return src ? fetch(src).then((r) => r.ok).catch(() => false) : false;
  }).catch(() => false);
  check(stillThere, "the game's own files went missing after the editor saved itself");

  // ---- 6. a save that didn't finish ---------------------------------------
  // The badge is only worth having if it can say no. A file that fails to
  // download must leave the reader told, not quietly boarding with a game that
  // half-exists — and the half that did save must survive, because evicting it
  // would turn one flaky request into a game that no longer works at all.
  await context.setOffline(false);
  fail.add("/assets/tiles/bat.png");
  const flaky = await browser.newContext({ viewport: { width: 430, height: 930 } });
  const fp = await flaky.newPage();
  await fp.goto(`${origin}/index.html`, { waitUntil: "load" });
  await fp.waitForFunction(() => window.cantoriOffline && /ready|incomplete/.test(window.cantoriOffline.state),
    null, { timeout: 60000 }).catch(() => {});

  const partial = await fp.evaluate(() => window.cantoriOffline);
  check(partial && partial.state === "incomplete", `a failed download still reported "${partial && partial.state}"`);
  check(partial && partial.missing === 1, `expected 1 missing file, got ${partial && partial.missing}`);
  const warned = await fp.evaluate(() => {
    const e = document.getElementById("offlineBadge");
    return e ? { text: e.textContent, warn: e.className.includes("warn") } : null;
  });
  check(warned && warned.warn && /not fully saved/i.test(warned.text), `no warning badge shown (${JSON.stringify(warned)})`);

  fail.clear();
  await fp.reload({ waitUntil: "load" });
  await fp.waitForFunction(() => window.cantoriOffline && window.cantoriOffline.state === "ready",
    null, { timeout: 60000 }).catch(() => {});
  await flaky.setOffline(true);
  const recovered = await fp.reload({ waitUntil: "load" })
    .then(() => fp.waitForFunction(() => window.cantori && window.CANTORI_DATA, null, { timeout: 20000 }))
    .then(() => true).catch(() => false);
  check(recovered, "a half-saved game never recovered, even with the signal back");

  await browser.close();
  server.close();

  if (failures.length) {
    console.error(`FAILED — ${failures.length} of ${checks} checks:`);
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log(`ok — ${checks} checks passed; the game plays with the network off`);
}

main().catch((e) => { console.error(e); process.exit(1); });
