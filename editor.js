/* ============================================================================
   Cantori — Content Editor (admin)
   A no-backend editor for the game's content. It reads the same data.js the game
   uses, lets you add/edit/remove entries in tables (or raw JSON for the complex
   bits), then:
     • Playtest  — stashes the draft in localStorage; the game reads it on load.
     • Copy for Claude / Download — hands you the finished data.js to commit.
   Nothing here talks to a server; your draft lives in this browser until you
   export it.
   ========================================================================== */
(function () {
  "use strict";
  const SHIPPED = window.CANTORI_DATA;
  const LSKEY = "cantori_data_override";
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const $ = (id) => document.getElementById(id);

  // Load working source: an in-progress draft if one exists, else the shipped data.
  let source;
  try { const d = localStorage.getItem(LSKEY); source = d ? JSON.parse(d) : clone(SHIPPED); }
  catch (e) { source = clone(SHIPPED); }

  const TABLE_COLLS = ["monsters", "gear", "consumables", "bosses"];
  const JSON_COLLS = ["biomes", "classes", "loot", "stats", "gods"];
  const TABS = TABLE_COLLS.concat(JSON_COLLS);

  // Column specs for the table editors. type: key|text|num|bool|color|select.
  const SPECS = {
    monsters: [
      { f: "__key", label: "key", type: "key" },
      { f: "name", type: "text", cls: "name" },
      { f: "hp", type: "num" }, { f: "atkMin", type: "num" }, { f: "atkMax", type: "num" },
      { f: "speed", type: "num", step: "0.1" },
      { f: "acc", type: "num" }, { f: "eva", type: "num" },
      { f: "range", type: "num" }, { f: "minFloor", type: "num" },
      { f: "charge", type: "bool" }, { f: "ranged", type: "bool" },
      { f: "glyph", type: "text" }, { f: "color", type: "color" },
    ],
    gear: [
      { f: "__key", label: "key", type: "key" },
      { f: "cat", type: "select", opts: ["weapon", "armor", "ring", "trinket", "necklace"] },
      { f: "name", type: "text", cls: "name" },
      { f: "dmgMin", label: "dmg min", type: "num" }, { f: "dmgMax", label: "dmg max", type: "num" },
      { f: "speed", type: "num", step: "0.1" }, { f: "accuracy", label: "acc", type: "num" },
      { f: "def", type: "num" },
      { f: "tier", type: "num" }, { f: "rarity", label: "rarity %", type: "num" },
      { f: "reqSTR", label: "req STR", type: "num" },
      { f: "glyph", type: "text" }, { f: "color", type: "color" },
    ],
    consumables: [
      { f: "__key", label: "key", type: "key" },
      { f: "cat", type: "select", opts: ["potion", "scroll", "tool"] },
      { f: "name", type: "text", cls: "name" },
      { f: "effect", type: "text" }, { f: "weight", type: "num" },
      { f: "glyph", type: "text" }, { f: "color", type: "color" },
    ],
    bosses: [
      { f: "__key", label: "key", type: "key" },
      { f: "name", type: "text", cls: "name" },
      { f: "hp", type: "num" }, { f: "atkMin", type: "num" }, { f: "atkMax", type: "num" },
    ],
  };
  // Blank templates when adding a row.
  const TEMPLATES = {
    monsters: { name: "New Monster", hp: 5, atkMin: 1, atkMax: 2, glyph: "?", color: "#c0c0c0" },
    gear: { cat: "weapon", name: "New Gear", dmgMin: 1, dmgMax: 3, speed: 1, accuracy: 0, tier: 1, req: { STR: 0 }, glyph: "/", color: "#cccccc" },
    consumables: { cat: "potion", name: "New Item", effect: "heal", weight: 1, glyph: "!", color: "#cccccc" },
    bosses: { name: "New Boss", hp: 40, atkMin: 4, atkMax: 6 },
  };

  // Editing state: table rows as [{key,obj}], json collections as text + parsed cache.
  const rows = {};
  for (const c of TABLE_COLLS) rows[c] = Object.entries(source[c] || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
  const jsonText = {}, jsonOk = {};
  for (const c of JSON_COLLS) { jsonText[c] = JSON.stringify(source[c] != null ? source[c] : {}, null, 2); jsonOk[c] = true; }

  let activeTab = "monsters";

  // ---- Field get/set (maps reqSTR <-> req.STR, drops empty optionals) --------
  function getField(obj, f) {
    if (f === "reqSTR") return obj.req && obj.req.STR != null ? obj.req.STR : "";
    const v = obj[f];
    return v == null ? "" : v;
  }
  function setField(obj, f, type, raw, checked) {
    if (f === "reqSTR") {
      if (raw === "" ) delete obj.req; else obj.req = { STR: Number(raw) };
      return;
    }
    if (type === "bool") { if (checked) obj[f] = true; else delete obj[f]; return; }
    if (type === "num") { if (raw === "") delete obj[f]; else obj[f] = Number(raw); return; }
    obj[f] = raw;   // text / color / select
  }

  // ---- Rendering -------------------------------------------------------------
  function renderTabs() {
    const nav = $("tabs"); nav.innerHTML = "";
    for (const t of TABS) {
      const b = document.createElement("button");
      b.className = "tab" + (t === activeTab ? " on" : "");
      b.textContent = t;
      b.onclick = () => { syncJsonFromDom(); activeTab = t; render(); };
      nav.appendChild(b);
    }
  }

  function render() {
    renderTabs();
    const main = $("main");
    main.innerHTML = "";
    if (TABLE_COLLS.includes(activeTab)) main.appendChild(renderTable(activeTab));
    else main.appendChild(renderJson(activeTab));
    setStatus("");
  }

  function renderTable(coll) {
    const wrap = document.createElement("div");
    const spec = SPECS[coll];
    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); h.textContent = coll + " — " + rows[coll].length + " entries";
    bar.appendChild(h); wrap.appendChild(bar);

    const note = document.createElement("p"); note.className = "hint";
    note.textContent = tableHint(coll);
    wrap.appendChild(note);

    const tw = document.createElement("div"); tw.className = "tablewrap";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    for (const col of spec) { const th = document.createElement("th"); th.textContent = col.label || col.f; htr.appendChild(th); }
    htr.appendChild(document.createElement("th"));
    thead.appendChild(htr); table.appendChild(thead);

    const tbody = document.createElement("tbody");
    rows[coll].forEach((row, i) => tbody.appendChild(renderRow(coll, row, i)));
    table.appendChild(tbody);
    tw.appendChild(table); wrap.appendChild(tw);

    const add = document.createElement("div"); add.className = "addrow";
    const btn = document.createElement("button"); btn.textContent = "+ Add " + coll.replace(/s$/, "");
    btn.onclick = () => {
      rows[coll].push({ key: uniqueKey(coll, "new_" + coll.replace(/s$/, "")), obj: clone(TEMPLATES[coll]) });
      render();
    };
    add.appendChild(btn); wrap.appendChild(add);
    return wrap;
  }

  function renderRow(coll, row, i) {
    const spec = SPECS[coll];
    const tr = document.createElement("tr");
    for (const col of spec) {
      const td = document.createElement("td");
      td.appendChild(makeInput(coll, row, col));
      tr.appendChild(td);
    }
    const td = document.createElement("td");
    const del = document.createElement("button"); del.className = "del"; del.textContent = "✕";
    del.title = "delete";
    del.onclick = () => { rows[coll].splice(i, 1); render(); };
    td.appendChild(del); tr.appendChild(td);
    return tr;
  }

  function makeInput(coll, row, col) {
    if (col.type === "key") {
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "key"; inp.value = row.key;
      inp.oninput = () => { row.key = inp.value.trim(); };
      return inp;
    }
    if (col.type === "bool") {
      const inp = document.createElement("input"); inp.type = "checkbox"; inp.checked = !!row.obj[col.f];
      inp.onchange = () => setField(row.obj, col.f, "bool", "", inp.checked);
      return inp;
    }
    if (col.type === "select") {
      const sel = document.createElement("select");
      for (const o of col.opts) { const op = document.createElement("option"); op.value = o; op.textContent = o; sel.appendChild(op); }
      sel.value = getField(row.obj, col.f) || col.opts[0];
      sel.onchange = () => setField(row.obj, col.f, "select", sel.value);
      return sel;
    }
    if (col.type === "color") {
      const inp = document.createElement("input"); inp.type = "color";
      inp.value = normHex(getField(row.obj, col.f)) || "#cccccc";
      inp.oninput = () => setField(row.obj, col.f, "text", inp.value);
      return inp;
    }
    const inp = document.createElement("input");
    inp.type = col.type === "num" ? "number" : "text";
    if (col.step) inp.step = col.step;
    if (col.cls) inp.className = col.cls;
    inp.value = getField(row.obj, col.f);
    inp.oninput = () => setField(row.obj, col.f, col.type, inp.value);
    return inp;
  }

  function renderJson(coll) {
    const wrap = document.createElement("div");
    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); h.textContent = coll + " (JSON)";
    bar.appendChild(h); wrap.appendChild(bar);
    const note = document.createElement("p"); note.className = "hint"; note.textContent = jsonHint(coll);
    wrap.appendChild(note);
    const ta = document.createElement("textarea"); ta.className = "json"; ta.id = "json-" + coll; ta.value = jsonText[coll];
    ta.spellcheck = false;
    const err = document.createElement("div"); err.className = "jsonerr"; err.id = "jsonerr-" + coll;
    ta.oninput = () => {
      jsonText[coll] = ta.value;
      try { JSON.parse(ta.value); jsonOk[coll] = true; err.textContent = ""; }
      catch (e) { jsonOk[coll] = false; err.textContent = "Invalid JSON: " + e.message; }
    };
    wrap.appendChild(ta); wrap.appendChild(err);
    return wrap;
  }

  function syncJsonFromDom() {
    if (JSON_COLLS.includes(activeTab)) {
      const ta = $("json-" + activeTab);
      if (ta) { jsonText[activeTab] = ta.value; try { JSON.parse(ta.value); jsonOk[activeTab] = true; } catch (e) { jsonOk[activeTab] = false; } }
    }
  }

  // ---- Build the final data object ------------------------------------------
  function buildData() {
    syncJsonFromDom();
    const out = clone(source);
    const problems = [];
    for (const coll of TABLE_COLLS) {
      const o = {}; const seen = {};
      for (const { key, obj } of rows[coll]) {
        if (!key) { problems.push(coll + ": a row has an empty key"); continue; }
        if (seen[key]) problems.push(coll + ": duplicate key “" + key + "”");
        seen[key] = 1; o[key] = obj;
      }
      out[coll] = o;
    }
    for (const coll of JSON_COLLS) {
      try { out[coll] = JSON.parse(jsonText[coll]); }
      catch (e) { problems.push(coll + " JSON: " + e.message); }
    }
    return { data: out, problems };
  }

  function dataFileText(data) {
    return "/* Cantori content data — generated by editor.html. Edit via the editor,\n" +
           "   or by hand (it's plain data). The game loads window.CANTORI_DATA. */\n" +
           "window.CANTORI_DATA = " + JSON.stringify(data, null, 2) + ";\n";
  }

  // ---- Toolbar actions -------------------------------------------------------
  function setStatus(msg, kind) { const s = $("status"); s.textContent = msg; s.className = kind || ""; }
  function draftActive() { try { return !!localStorage.getItem(LSKEY); } catch (e) { return false; } }
  function refreshDraftButtons() { $("btnStop").style.display = draftActive() ? "" : "none"; }

  function doPlaytest() {
    const { data, problems } = buildData();
    if (problems.length) { setStatus("Fix: " + problems[0], "err"); return; }
    try { localStorage.setItem(LSKEY, JSON.stringify(data)); }
    catch (e) { setStatus("Could not save draft: " + e.message, "err"); return; }
    refreshDraftButtons();
    setStatus("Draft saved — opening game…", "ok");
    window.open("./index.html", "_blank");
  }
  function doStop() {
    try { localStorage.removeItem(LSKEY); } catch (e) {}
    refreshDraftButtons();
    setStatus("Playtest draft cleared — the game uses the shipped data again.", "ok");
  }
  function doCopy() {
    const { data, problems } = buildData();
    if (problems.length) { setStatus("Fix: " + problems[0], "err"); return; }
    $("copyText").value = dataFileText(data);
    $("copyMsg").textContent = "";
    $("copyDlg").showModal();
  }
  function doDownload() {
    const { data, problems } = buildData();
    if (problems.length) { setStatus("Fix: " + problems[0], "err"); return; }
    const blob = new Blob([dataFileText(data)], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "data.js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Downloaded data.js", "ok");
  }
  function doRevert() {
    if (!confirm("Discard all edits and reload the shipped content?")) return;
    source = clone(SHIPPED);
    for (const c of TABLE_COLLS) rows[c] = Object.entries(source[c] || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
    for (const c of JSON_COLLS) { jsonText[c] = JSON.stringify(source[c] != null ? source[c] : {}, null, 2); jsonOk[c] = true; }
    render();
    setStatus("Reverted to shipped content.", "ok");
  }

  // ---- Helpers ---------------------------------------------------------------
  function uniqueKey(coll, base) {
    const taken = {}; for (const r of rows[coll]) taken[r.key] = 1;
    if (!taken[base]) return base;
    let i = 2; while (taken[base + i]) i++; return base + i;
  }
  function normHex(v) {
    if (typeof v !== "string") return "";
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    if (/^#[0-9a-fA-F]{3}$/.test(v)) return "#" + v.slice(1).split("").map((c) => c + c).join("");
    return "";
  }
  function tableHint(coll) {
    return ({
      monsters: "minFloor is the ON/OFF switch: leave it EMPTY to disable a monster, or set 1–5 to enable it (and set the earliest biome-floor it appears on). A monster must also be listed in a biome (Biomes tab) to show up there. speed (>1 acts more often, <1 less; blank = 1). Blank acc/eva/range/charge/ranged use engine defaults. Sprite = assets/tiles/<key>.png.",
      gear: "cat sets the equip slot. WEAPONS use dmg min/max, speed (>1 fast, <1 slow), and acc; ARMOR uses def; JEWELRY uses neither (value = rolled affixes). tier drives affix size AND groups drops. rarity % = this type's drop chance within its tier+category; leave it EMPTY to be a 'default' that splits the remaining %. Tier-by-floor and category odds live in the Loot tab. Sprites come from assets/tiles/<key>.png; keys with no sprite draw their glyph.",
      consumables: "effect is what it does: heal, strength, poison, map, teleport, burn. weight 0 = never drops as loot (e.g. torch).",
      bosses: "One boss guards floor 5 of each biome. Which biome uses which boss is set on the Biomes tab.",
    })[coll] || "";
  }
  function jsonHint(coll) {
    return ({
      biomes: "Ordered list of the 5 biomes. Each: key, name, floor/wall sprite names, monsters (keys), boss (a bosses key), optional bossCount, spawnInitial/spawnEvery/spawnCap, exitStyle/exitSprite, door (\"bush\"/\"door\"), final.",
      classes: "Player classes and their starting kit + skill trees. Edited as JSON for now (nested structure).",
      loot: "Rarity table, stat pool, and enchant definitions for the loot system.",
      stats: "Design reference for the six stats (display only).",
      gods: "Design reference for the boon gods (boons not yet wired in).",
    })[coll] || "Raw JSON for this section.";
  }

  // ---- Wire up ---------------------------------------------------------------
  $("btnPlay").onclick = doPlaytest;
  $("btnStop").onclick = doStop;
  $("btnCopy").onclick = doCopy;
  $("btnDownload").onclick = doDownload;
  $("btnRevert").onclick = doRevert;
  $("copyClose").onclick = () => $("copyDlg").close();
  $("copyNow").onclick = () => {
    const ta = $("copyText"); ta.select();
    const done = () => { $("copyMsg").textContent = "Copied!"; };
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, () => { document.execCommand("copy"); done(); });
    else { document.execCommand("copy"); done(); }
  };

  render();
  refreshDraftButtons();
  setStatus(draftActive() ? "Editing a saved draft (Playtest active)." : "Loaded shipped content.", "ok");
})();
