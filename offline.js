/* Cantori — offline registration + the "safe to fly" badge.
   ----------------------------------------------------------------------------
   Loaded last by index.html and by editor.html. It does three things:

     1. registers sw.js,
     2. reads THIS document's own asset URLs out of the DOM — every <script src>
        and <link href>, ?v= and all — and hands that list to the worker, which
        is why the worker needs no hand-maintained file list and cannot fall out
        of step with CLAUDE.md rule 4,
     3. says out loud whether the game is actually saved.

   (3) is not decoration. "It'll probably work offline" is worth nothing at the
   gate; the badge only says ready once the worker has confirmed every last URL
   is in the cache, and says so plainly when it hasn't.

   Kept self-contained — its own <style>, no house CSS — because it is shared by
   two pages that share no stylesheet.
   ========================================================================== */
(() => {
  "use strict";
  const SELF = document.currentScript;             // captured now; it's null once we're async
  if (!("serviceWorker" in navigator)) return;     // plain online play, exactly as before

  const state = window.cantoriOffline = { state: "collecting", done: 0, total: 0, missing: 0 };

  // ---- what this page is made of ------------------------------------------
  const urls = new Set();
  const add = (u, base) => {
    if (!u) return;
    let a;
    try { a = new URL(u, base || location.href); } catch (e) { return; }
    if (a.origin !== location.origin) return;      // GitHub's API and friends are not ours to keep
    a.hash = "";
    urls.add(a.href);
  };

  add(location.pathname);                          // this document, minus whatever query brought us here
  for (const s of document.querySelectorAll("script[src]")) add(s.getAttribute("src"));
  for (const l of document.querySelectorAll("link[href]")) {
    if (/^(stylesheet|manifest|icon|apple-touch-icon)$/i.test(l.getAttribute("rel") || "")) add(l.getAttribute("href"));
  }
  // The game page also declares the manifest's start_url, which is the bare
  // directory: a home-screen launch asks for "./", not "./index.html", and an
  // unsaved start_url is a blank screen on a plane. The editor declares nothing,
  // so warming from the editor never claims the game is ready when it isn't.
  if (SELF && SELF.dataset.shell) add(SELF.dataset.shell);
  // Sprites come from the game's own roster rather than a list kept here, so
  // adding a monster stays a data.js edit (rule 1) and can't quietly ship a
  // creature that renders blank once you're in the air.
  if (window.cantori && window.cantori.spriteUrls) {
    try { window.cantori.spriteUrls().forEach((u) => add(u)); } catch (e) { /* older build; the shell is still worth saving */ }
  }

  // The home-screen icons are named only inside the manifest, so the DOM sweep
  // above can't see icon-512. One fetch beats keeping a second copy of the list
  // here, and beats a badge that says "everything is saved" while meaning "most".
  async function manifestIcons() {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    const href = new URL(link.getAttribute("href"), location.href).href;
    try {
      const res = await fetch(href);
      if (!res.ok) return;
      for (const icon of (await res.json()).icons || []) add(icon.src, href);   // icon srcs are relative to the manifest
    } catch (e) { /* offline already, or a manifest that won't parse — neither is worth failing over */ }
  }

  // ---- the badge -----------------------------------------------------------
  let el = null, hideAt = 0;
  function badge(text, tone, lingerMs) {
    if (!el) {
      const style = document.createElement("style");
      style.textContent =
        "#offlineBadge{position:fixed;left:50%;transform:translateX(-50%);" +
        // Above every overlay in styles.css (the highest is 21). The game opens on
        // the hero-select screen, which is precisely when a first-time visitor is
        // waiting to hear whether the download finished — a badge behind it is a
        // badge that isn't there.
        "top:calc(env(safe-area-inset-top) + 56px);z-index:40;" +
        "padding:6px 12px;border-radius:999px;cursor:pointer;" +
        "font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;" +
        "font-size:11px;font-weight:700;letter-spacing:.06em;white-space:nowrap;" +
        "background:rgba(21,17,11,.92);border:1px solid #2a2114;color:#8a7c63;" +
        "box-shadow:0 2px 12px rgba(0,0,0,.55);-webkit-tap-highlight-color:transparent;" +
        "transition:opacity .4s ease}" +
        "#offlineBadge.ready{color:#7ec98a;border-color:#7ec98a}" +
        "#offlineBadge.warn{color:#f0a838;border-color:#f0a838}" +
        "#offlineBadge.gone{opacity:0;pointer-events:none}";
      document.head.appendChild(style);
      el = document.createElement("div");
      el.id = "offlineBadge";
      el.onclick = () => el.classList.add("gone");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.className = tone || "";
    // A later message must be able to re-show a badge the reader dismissed, but
    // the dismissal shouldn't be undone by a progress tick that arrives after it.
    if (lingerMs) {
      const mine = hideAt = Date.now() + lingerMs;
      setTimeout(() => { if (hideAt === mine && el) el.classList.add("gone"); }, lingerMs);
    } else {
      hideAt = 0;
    }
  }

  // ---- register, then warm -------------------------------------------------
  (async () => {
    await manifestIcons();
    state.total = urls.size;
    state.state = "registering";

    const reg = await navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready);
    const sw = reg.active;
    if (!sw) { state.state = "idle"; return; }

    const t0 = Date.now();
    const chan = new MessageChannel();
    let announced = false;
    chan.port1.onmessage = (e) => {
      const m = e.data || {};
      state.done = m.done || 0;
      state.missing = m.missing || 0;

      if (m.type === "progress") {
        // Say nothing while the cache is merely being confirmed — on every visit
        // after the first there is nothing to fetch, and a flash of "saving…" on
        // a game you saved weeks ago reads as a problem rather than a fact.
        if (m.done < m.total && Date.now() - t0 > 400) {
          state.state = "saving";
          announced = true;
          badge("✈ Saving for offline… " + Math.round((m.done / Math.max(1, m.total)) * 100) + "%");
        }
        return;
      }

      if (m.missing) {
        state.state = "incomplete";
        badge("✈ Not fully saved — reload with a signal", "warn");
      } else {
        // Worth saying even when there was nothing left to fetch: the question a
        // reader has before boarding is whether this thing is safe to take, and a
        // badge that only ever appears once can't answer it.
        state.state = "ready";
        badge(navigator.onLine ? "✈ Ready to play offline" : "✈ Playing offline", "ready", announced ? 4000 : 2500);
      }
    };

    state.state = "saving";
    sw.postMessage({ type: "warm", urls: [...urls] }, [chan.port2]);
  })().catch(() => {
    // A registration that fails (a file:// open, a locked-down or private-mode
    // browser) costs nothing but the offline copy — the game itself is untouched.
    state.state = "unavailable";
  });
})();
