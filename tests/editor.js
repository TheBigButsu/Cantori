#!/usr/bin/env node
/* Cantori editor round-trip test.
 *
 * The editor rewrites data.js WHOLESALE (CLAUDE.md rule 2), so a field it doesn't
 * know about is silently dropped the next time content is edited in the browser —
 * and the loss only shows up later, as content that "vanished". This boots the real
 * editor.html in headless Chromium, drives the same buildData() the Commit button
 * uses, and diffs the result against data.js on disk.
 *
 * A dropped or altered field fails the run. Skill-tree prerequisites are the one
 * documented normalisation: `req: ["spin"]` is canonicalised to `[["spin", 1]]`,
 * which the engine reads identically, so both sides are normalised before diffing.
 *
 * Usage:  node tests/editor.js [--headed]
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..");
const HEADED = process.argv.includes("--headed");

// ---- playwright resolution (same fallback chain as smoke.js) ---------------
function loadChromium() {
  try { return require("playwright").chromium; } catch (e) { /* fall through */ }
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(path.join(globalRoot, "index.js"))("playwright").chromium;
  } catch (e) { /* fall through */ }
  console.error("Cantori editor test needs Playwright.\n" +
    "  Install it locally:  npm i -D playwright && npx playwright install chromium\n" +
    "  ...or globally:      npm i -g playwright");
  process.exit(2);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/json" };
function serve() {
  return http.createServer((rq, rs) => {
    const f = path.join(ROOT, decodeURIComponent(rq.url.split("?")[0]));
    fs.readFile(f, (e, d) => {
      if (e) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      rs.end(d);
    });
  });
}

// data.js is a JS file wrapping one JSON literal — pull the literal back out.
const literal = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

// A prerequisite is authored either as a bare id or as [id, rank]; the engine reads
// a bare id as rank 1. normalizeTree canonicalises to the pair form, so do the same
// on both sides rather than calling a round trip through it a difference.
function canonPrereqs(node) {
  for (const f of ["req", "reqAny"]) {
    if (!Array.isArray(node[f])) continue;
    node[f] = node[f].map((r) => (Array.isArray(r) ? r : [r, 1]));
  }
  return node;
}
function canon(data) {
  const d = JSON.parse(JSON.stringify(data));
  for (const c of Object.values(d.classes || {})) {
    if (Array.isArray(c.skillTree)) c.skillTree.forEach(canonPrereqs);
  }
  return d;
}
// Flatten to leaf paths so a diff names the exact field, not a wall of JSON.
function flat(o, p, out) {
  out = out || {}; p = p || "";
  if (o && typeof o === "object" && !Array.isArray(o)) {
    const keys = Object.keys(o);
    if (!keys.length) out[p] = "{}";
    for (const k of keys) flat(o[k], p + "/" + k, out);
  } else out[p] = JSON.stringify(o);
  return out;
}

async function main() {
  const chromium = loadChromium();
  const server = serve();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`http://localhost:${port}/editor.html`, { waitUntil: "networkidle" });
  // "Copy for Claude" runs buildData() + dataFileText() — the exact bytes the
  // Commit button would push to GitHub.
  const text = await page.evaluate(() => {
    document.getElementById("btnCopy").click();
    return document.getElementById("copyText").value;
  });
  await browser.close();
  server.close();

  const failures = [];
  if (!text || text.indexOf("window.CANTORI_DATA") < 0) failures.push("the editor produced no data.js text (buildData rejected the shipped data?)");
  for (const e of errors) failures.push("console error: " + e);

  if (text) {
    const onDisk = flat(canon(literal(fs.readFileSync(path.join(ROOT, "data.js"), "utf8"))));
    const out = flat(canon(literal(text)));
    for (const k of Object.keys(onDisk)) {
      if (!(k in out)) failures.push(`DROPPED ${k} (was ${onDisk[k]})`);
      else if (onDisk[k] !== out[k]) failures.push(`CHANGED ${k}: ${onDisk[k]} -> ${out[k]}`);
    }
    for (const k of Object.keys(out)) if (!(k in onDisk)) failures.push(`ADDED ${k} = ${out[k]}`);
    if (!failures.length) console.log(`ok — editor round-trips all ${Object.keys(onDisk).length} fields of data.js unchanged`);
  }

  if (failures.length) {
    console.error(`\nFAIL — the editor would not preserve data.js:\n`);
    for (const f of failures.slice(0, 40)) console.error("  · " + f);
    if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
    console.error("\nTeach editor.js the field (CLAUDE.md rule 2) — otherwise the next browser edit drops it.");
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
