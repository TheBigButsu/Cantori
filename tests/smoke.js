#!/usr/bin/env node
/* Cantori smoke test.
 *
 * Boots the real page in headless Chromium and drives it through the window.cantori
 * dev hooks, checking the two things that actually break the game when a packet goes
 * wrong: a floor you cannot finish, and a crash in the turn loop.
 *
 * For every depth 1..25 it regenerates the floor N times and asserts that
 *   - the way onward exists and is reachable on foot from where you start
 *     (stairs on a normal floor; the boss on a boss floor, since the exit only
 *      opens when the boss dies)
 *   - monsters actually spawned
 * then runs the world forward some turns to shake out monster-AI and boss-playbook
 * crashes. Any console error or uncaught exception anywhere fails the run.
 *
 * Usage:  node tests/smoke.js [--iterations 6] [--depths 25] [--turns 25] [--headed]
 *
 * Needs Playwright. This repo has no dependencies and no build step, so the test
 * resolves Playwright from a local node_modules if there is one, otherwise from the
 * global install.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const argNum = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const ITERATIONS = argNum("--iterations", 6);   // regenerations per depth
const DEPTHS = argNum("--depths", 25);
const TURNS = argNum("--turns", 25);            // world turns run per depth
const HEADED = argv.includes("--headed");

// ---- playwright resolution -------------------------------------------------
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

// ---- a tiny static server (no dependencies) --------------------------------
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".md": "text/plain",
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const rel = path.normalize(url === "/" ? "/index.html" : url).replace(/^(\.\.[/\\])+/, "");
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
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
  const { server, port } = await serve();
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 430, height: 930 } });

  const errors = [];
  page.on("pageerror", (err) => errors.push("uncaught: " + err.message));
  page.on("console", (msg) => {
    // A failed asset shows up here only as a bare "404" with no URL, which is
    // useless to act on — the response handler below reports those instead.
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) {
      errors.push("console: " + msg.text());
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      const url = res.url().replace(`http://127.0.0.1:${port}`, "");
      const hint = /assets\/tiles\//.test(url)
        ? " — a data.js entry has no matching sprite (see CLAUDE.md rule 3)" : "";
      errors.push(`missing asset ${res.status()}: ${url}${hint}`);
    }
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.cantori && window.CANTORI_DATA, null, { timeout: 15000 });

  // The run opens on the hero-select overlay — pick the first startable class.
  await page.evaluate(() => {
    const roster = window.cantori.classRoster();
    window.cantori.pickClass(roster[0]);
  });

  const bossKeys = await page.evaluate(() => Object.keys(window.CANTORI_DATA.bosses));

  for (let d = 1; d <= DEPTHS; d++) {
    const state = await page.evaluate(() => window.cantori.peek());

    if (state.inShop) {                       // merchant floor: one room, nothing to prove
      await page.evaluate(() => window.cantori.descend());
      d--;                                    // the merchant sits between depths
      continue;
    }

    for (let i = 0; i < ITERATIONS; i++) {
      const r = await page.evaluate((bosses) => {
        window.cantori.regenerate();
        const s = window.cantori.peek();
        const stairs = window.cantori.stairsAt();
        const boss = s.mlist.find((m) => bosses.indexOf(m.type) >= 0) || null;
        return {
          depth: s.depth, bossActive: s.bossActive, monsters: s.monsters, biome: s.biome,
          stairs, boss,
          stairsReachable: stairs ? window.cantori.reach(stairs.x, stairs.y) : false,
          bossReachable: boss ? window.cantori.reach(boss.x, boss.y) : false,
        };
      }, bossKeys);

      const at = `depth ${r.depth} (${r.biome}) iter ${i + 1}`;

      if (r.bossActive) {
        check(!!r.boss, `${at}: boss floor spawned no boss`);
        if (r.boss) check(r.bossReachable, `${at}: boss at ${r.boss.x},${r.boss.y} is unreachable on foot`);
      } else {
        check(!!r.stairs, `${at}: no stairs on the floor`);
        if (r.stairs) check(r.stairsReachable, `${at}: stairs at ${r.stairs.x},${r.stairs.y} are unreachable on foot`);
        check(r.monsters > 0, `${at}: no monsters spawned`);
      }
    }

    // Run the world forward: monster AI, boss playbooks, traps, damage over time.
    // Keep the player alive so a death doesn't cut the sweep short.
    await page.evaluate((turns) => {
      for (let t = 0; t < turns; t++) {
        if (t % 5 === 0) window.cantori.hurt(-500);   // top up HP; negative damage heals
        window.cantori.tick();
      }
    }, TURNS);

    const after = await page.evaluate(() => window.cantori.peek());
    check(after.hp > 0, `depth ${d}: player died during the AI churn`);

    if (d < DEPTHS) await page.evaluate(() => window.cantori.descend());
  }

  for (const e of errors) check(false, e);

  await browser.close();
  server.close();

  if (failures.length) {
    console.error(`\nFAIL — ${failures.length} of ${checks} checks failed:\n`);
    const seen = new Map();
    for (const f of failures) seen.set(f, (seen.get(f) || 0) + 1);
    for (const [msg, n] of seen) console.error("  · " + msg + (n > 1 ? `  (×${n})` : ""));
    console.error("");
    process.exit(1);
  }
  console.log(`ok — ${checks} checks passed across ${DEPTHS} depths × ${ITERATIONS} regenerations`);
}

main().catch((err) => { console.error(err); process.exit(1); });
