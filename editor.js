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
  const JSON_COLLS = ["loot", "stats", "gods"];
  const TABS = TABLE_COLLS.concat(["biomes", "classes", "enchants"]).concat(JSON_COLLS);
  const STAT_KEYS = ["STR", "INT", "VIT", "DEX", "RES", "LCK"];
  const GEAR_CATS = ["weapon", "armor", "ring", "trinket", "necklace"];
  const TIERS = 5, SLOTS = 5;   // skill tree: 5 tiers × 5 options

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
      { f: "sub", label: "subtype", type: "select", opts: ["", "dagger", "sword", "axe", "spear", "bow", "light", "medium", "heavy"] },
      { f: "name", type: "text", cls: "name" },
      { f: "dmgMin", label: "dmg min", type: "num" }, { f: "dmgMax", label: "dmg max", type: "num" },
      { f: "speed", type: "num", step: "0.1" }, { f: "accuracy", label: "acc", type: "num" },
      { f: "range", type: "num" },
      { f: "defMin", label: "def min", type: "num" }, { f: "defMax", label: "def max", type: "num" },
      { f: "tier", type: "num" }, { f: "rarity", label: "rarity %", type: "num" },
      { f: "reqSTR", label: "req STR", type: "num" },
      { f: "glyph", type: "text" }, { f: "color", type: "color" },
    ],
    consumables: [
      { f: "__key", label: "key", type: "key" },
      { f: "cat", type: "select", opts: ["potion", "scroll", "tool"] },
      { f: "name", type: "text", cls: "name" },
      { f: "effect", type: "text" }, { f: "noDrop", label: "no drop", type: "bool" },
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
    consumables: { cat: "potion", name: "New Item", effect: "heal", glyph: "!", color: "#cccccc" },
    bosses: { name: "New Boss", hp: 40, atkMin: 4, atkMax: 6 },
  };

  // Editing state: table rows as [{key,obj}], json collections as text + parsed cache.
  const rows = {};
  for (const c of TABLE_COLLS) rows[c] = Object.entries(source[c] || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
  const sortState = {};   // per-table { f, dir } — click a header to sort by that column
  const filterText = {};  // per-table search string — type to filter rows
  const jsonText = {}, jsonOk = {};
  for (const c of JSON_COLLS) {
    let src = source[c] != null ? source[c] : {};
    if (c === "loot") { src = Object.assign({}, src); delete src.enchants; }   // enchants get their own tab
    jsonText[c] = JSON.stringify(src, null, 2); jsonOk[c] = true;
  }
  let biomeRows = clone(source.biomes || []);   // biomes are an ordered array of cards
  let enchantRows = Object.entries((source.loot && source.loot.enchants) || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
  let classRows = Object.entries(source.classes || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
  let activeClass = 0;
  const flippedEnch = new Set();    // enchant rows currently showing raw code
  const flippedSkill = new Set();   // skill cells currently showing raw code, keyed "cls:t,s"
  // The effect kinds the engine understands, and the numbers each one reads.
  // Leaving a param blank makes the engine fall back to its built-in default.
  const EFFECT_TYPES = ["", "burn", "poison", "shock", "thorns", "haste", "defense"];
  const EFFECT_PARAMS = {
    burn:    [["burstMult", "burst × power", "0.05"], ["dotTurns", "burn turns", "1"]],
    poison:  [["initial", "initial hit", "1"], ["perTurn", "dmg / turn", "1"], ["turns", "turns per dose", "1"]],
    shock:   [["burstMult", "burst × power", "0.05"], ["stunPer", "stun / power", "0.01"]],
    thorns:  [["mult", "reflect × power", "0.05"]],
    haste:   [["mult", "haste (0–1)", "0.05"]],
    defense: [["amount", "+block / hit", "1"]],
  };
  // A reusable "flip to raw JSON" editor: shows the object as text, parses live,
  // and hands the parsed value back so the user can write the governing code directly.
  function codeEditor(obj, onParse) {
    const box = document.createElement("div"); box.className = "codewrap";
    const ta = document.createElement("textarea"); ta.className = "codebox"; ta.rows = 14; ta.spellcheck = false;
    ta.value = JSON.stringify(obj, null, 2);
    const msg = document.createElement("div"); msg.className = "codemsg ok"; msg.textContent = "✓ valid JSON";
    ta.oninput = () => {
      try { const parsed = JSON.parse(ta.value); onParse(parsed); msg.textContent = "✓ valid JSON — saved"; msg.className = "codemsg ok"; }
      catch (e) { msg.textContent = "✕ " + e.message; msg.className = "codemsg err"; }
    };
    box.appendChild(ta); box.appendChild(msg); return box;
  }
  // The Effect block of an enchant: a type dropdown plus the numbers that type reads.
  function renderEffect(o) {
    const box = document.createElement("div"); box.className = "bmons";
    const l = document.createElement("div"); l.className = "bmons-l"; l.textContent = "Effect (what it does):"; box.appendChild(l);
    const row = document.createElement("div"); row.className = "bgrid";
    const tw = document.createElement("label"); tw.className = "bfield";
    const tl = document.createElement("span"); tl.textContent = "type"; tw.appendChild(tl);
    const sel = document.createElement("select");
    for (const t of EFFECT_TYPES) { const op = document.createElement("option"); op.value = t; op.textContent = t || "(none)"; sel.appendChild(op); }
    sel.value = (o.effect && o.effect.type) || "";
    sel.onchange = () => { if (!sel.value) delete o.effect; else o.effect = { type: sel.value }; render(); };
    tw.appendChild(sel); row.appendChild(tw);
    for (const [pf, plabel, pstep] of (EFFECT_PARAMS[o.effect && o.effect.type] || [])) {
      const w = document.createElement("label"); w.className = "bfield";
      const s = document.createElement("span"); s.textContent = plabel; w.appendChild(s);
      const inp = document.createElement("input"); inp.type = "number"; inp.step = pstep;
      inp.value = (o.effect && o.effect[pf] != null) ? o.effect[pf] : "";
      inp.oninput = () => { o.effect = o.effect || { type: sel.value }; if (inp.value === "") delete o.effect[pf]; else o.effect[pf] = Number(inp.value); };
      w.appendChild(inp); row.appendChild(w);
    }
    box.appendChild(row); return box;
  }
  // Normalize a class: stats/start/levelUp exist, and the skill tree is a 5×5 grid
  // whose cells are either a skill object or null (a Diablo-style blank space).
  //   skill = { name, desc, levels: [up to 4 per-level notes], req: [[tier,slot], …] }
  function ensureClass(obj) {
    obj.stats = Object.assign({ STR: 5, INT: 5, VIT: 5, DEX: 5, RES: 5, LCK: 5 }, obj.stats || {});
    obj.start = obj.start || {};
    obj.levelUp = obj.levelUp || {};
    if (!Array.isArray(obj.skillTree)) obj.skillTree = [];
    for (let t = 0; t < TIERS; t++) {
      if (!Array.isArray(obj.skillTree[t])) obj.skillTree[t] = [];
      for (let s = 0; s < SLOTS; s++) {
        const c = obj.skillTree[t][s];
        if (c && c.name) {
          c.desc = c.desc || "";
          c.levels = Array.isArray(c.levels) ? c.levels.slice(0, 4) : [];
          c.req = Array.isArray(c.req) ? c.req : [];
          obj.skillTree[t][s] = c;
        } else obj.skillTree[t][s] = null;   // blank space
      }
      obj.skillTree[t].length = SLOTS;
    }
    obj.skillTree.length = TIERS;
  }
  classRows.forEach((r) => ensureClass(r.obj));
  function getPath(o, path) { return path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o); }
  function setPath(o, path, val) {
    const ks = path.split("."); let x = o;
    for (let i = 0; i < ks.length - 1; i++) { if (x[ks[i]] == null) x[ks[i]] = {}; x = x[ks[i]]; }
    const last = ks[ks.length - 1];
    if (val === undefined) delete x[last]; else x[last] = val;
  }

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
    if (type === "select") { if (raw === "") delete obj[f]; else obj[f] = raw; return; }
    obj[f] = raw;   // text / color
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
    else if (activeTab === "biomes") main.appendChild(renderBiomes());
    else if (activeTab === "classes") main.appendChild(renderClasses());
    else if (activeTab === "enchants") main.appendChild(renderEnchants());
    else main.appendChild(renderJson(activeTab));
    setStatus("");
  }

  // Value shown in a column for a row (handles the key column + reqSTR mapping).
  function cellValue(row, col) {
    if (col.f === "__key") return row.key || "";
    return getField(row.obj, col.f);   // "" when missing
  }
  // Does a row match the filter text? (any column contains the string)
  function rowMatches(coll, row, q) {
    for (const col of SPECS[coll]) {
      const v = cellValue(row, col);
      if (v != null && String(v).toLowerCase().indexOf(q) >= 0) return true;
    }
    return false;
  }
  // Compare two rows on a column; blanks always sink to the bottom.
  function cmpRows(a, b, col, dir) {
    const av = cellValue(a, col), bv = cellValue(b, col);
    const aE = (av === "" || av == null), bE = (bv === "" || bv == null);
    if (aE && bE) return 0;
    if (aE) return 1;
    if (bE) return -1;
    let r;
    if (col.type === "num") r = Number(av) - Number(bv);
    else r = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return dir === "desc" ? -r : r;
  }

  function renderTable(coll) {
    const wrap = document.createElement("div");
    const spec = SPECS[coll];

    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); bar.appendChild(h);
    const filt = document.createElement("input");
    filt.type = "text"; filt.className = "filter"; filt.placeholder = "filter…"; filt.value = filterText[coll] || "";
    bar.appendChild(filt);
    wrap.appendChild(bar);

    const note = document.createElement("p"); note.className = "hint";
    note.textContent = "Click a column header to sort by it (again to reverse); type in the filter box to narrow the list. " + tableHint(coll);
    wrap.appendChild(note);

    const tw = document.createElement("div"); tw.className = "tablewrap";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    for (const col of spec) {
      const th = document.createElement("th"); th.className = "sortable"; th.dataset.f = col.f;
      th.onclick = () => {
        const s = sortState[coll];
        if (s && s.f === col.f) s.dir = (s.dir === "asc" ? "desc" : "asc");
        else sortState[coll] = { f: col.f, dir: "asc" };
        rebuild();
      };
      htr.appendChild(th);
    }
    htr.appendChild(document.createElement("th"));   // delete column (not sortable)
    thead.appendChild(htr); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    tw.appendChild(table); wrap.appendChild(tw);

    const add = document.createElement("div"); add.className = "addrow";
    const btn = document.createElement("button"); btn.textContent = "+ Add " + coll.replace(/s$/, "");
    btn.onclick = () => {
      filterText[coll] = "";   // clear the filter so the new row is visible
      rows[coll].push({ key: uniqueKey(coll, "new_" + coll.replace(/s$/, "")), obj: clone(TEMPLATES[coll]) });
      render();
    };
    add.appendChild(btn); wrap.appendChild(add);

    // Recompute the filtered/sorted view and repaint just the header labels +
    // body (so typing in the filter box keeps focus).
    function rebuild() {
      const q = (filterText[coll] || "").trim().toLowerCase();
      let view = q ? rows[coll].filter((row) => rowMatches(coll, row, q)) : rows[coll].slice();
      const st = sortState[coll];
      if (st) { const col = spec.find((c) => c.f === st.f); if (col) view.sort((a, b) => cmpRows(a, b, col, st.dir)); }
      h.textContent = coll + " — " + (q ? view.length + " of " + rows[coll].length : rows[coll].length + " entries");
      const ths = thead.querySelectorAll("th");
      spec.forEach((col, idx) => {
        const on = st && st.f === col.f;
        ths[idx].textContent = (col.label || col.f) + (on ? (st.dir === "asc" ? " ▲" : " ▼") : "");
        ths[idx].classList.toggle("on", !!on);
      });
      tbody.innerHTML = "";
      view.forEach((row) => tbody.appendChild(renderRow(coll, row)));
    }
    filt.oninput = () => { filterText[coll] = filt.value; rebuild(); };
    rebuild();
    return wrap;
  }

  function renderRow(coll, row) {
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
    del.onclick = () => { const idx = rows[coll].indexOf(row); if (idx >= 0) rows[coll].splice(idx, 1); render(); };
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

  // ---- Biomes: a card editor (ordered array with a monster-picker) -----------
  function biomeField(b, label, f, type, opts) {
    const wrap = document.createElement("label"); wrap.className = "bfield";
    const span = document.createElement("span"); span.textContent = label; wrap.appendChild(span);
    let inp;
    if (type === "select") {
      inp = document.createElement("select");
      for (const o of opts) { const op = document.createElement("option"); op.value = o; op.textContent = o || "(none)"; inp.appendChild(op); }
      inp.value = b[f] != null ? b[f] : (opts[0] || "");
      inp.onchange = () => { if (inp.value === "") delete b[f]; else b[f] = inp.value; };
    } else if (type === "bool") {
      inp = document.createElement("input"); inp.type = "checkbox"; inp.checked = !!b[f];
      inp.onchange = () => { if (inp.checked) b[f] = true; else delete b[f]; };
    } else if (type === "num") {
      inp = document.createElement("input"); inp.type = "number"; inp.value = b[f] != null ? b[f] : "";
      inp.oninput = () => { if (inp.value === "") delete b[f]; else b[f] = Number(inp.value); };
    } else if (type === "spawn") {
      inp = document.createElement("input"); inp.type = "text";
      inp.value = Array.isArray(b[f]) ? b[f].join(",") : (b[f] != null ? String(b[f]) : "");
      inp.placeholder = "5  or  3,5,5,5";
      inp.oninput = () => {
        const v = inp.value.trim();
        if (v === "") delete b[f];
        else if (v.indexOf(",") >= 0) b[f] = v.split(",").map((s) => Number(s.trim()) || 0);
        else b[f] = Number(v);
      };
    } else {
      inp = document.createElement("input"); inp.type = "text"; inp.value = b[f] != null ? b[f] : "";
      inp.oninput = () => { if (inp.value === "") delete b[f]; else b[f] = inp.value; };
    }
    wrap.appendChild(inp);
    return wrap;
  }
  function renderBiomes() {
    const wrap = document.createElement("div");
    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); h.textContent = "biomes — " + biomeRows.length + " in depth order"; bar.appendChild(h);
    wrap.appendChild(bar);
    const note = document.createElement("p"); note.className = "hint";
    note.textContent = "The biomes in depth order (each is 5 floors). Monsters = which creatures can spawn here (click to toggle; a monster also needs a minFloor on the Monsters tab to actually appear). Spawn mix sets each monster's spawn weight per floor — e.g. rats 6→1 across F1–F5 makes them common early, rare deep. spawnInitial = how many spawn on a fresh floor — one number, or per-floor like 3,5,5,5. exitStyle \"wall\" carves the exit into the border; blank = stairs.";
    wrap.appendChild(note);
    const bossKeys = rows.bosses.map((r) => r.key);
    const monKeys = rows.monsters.map((r) => r.key);
    biomeRows.forEach((b, i) => {
      const card = document.createElement("div"); card.className = "bcard";
      const head = document.createElement("div"); head.className = "bhead";
      const title = document.createElement("b"); title.textContent = "Biome " + (i + 1) + " · " + (b.key || "?"); head.appendChild(title);
      const ctrls = document.createElement("span");
      const mk = (lab, tip, fn, dis) => { const bt = document.createElement("button"); bt.className = "bbtn"; bt.textContent = lab; bt.title = tip; bt.disabled = !!dis; bt.onclick = fn; return bt; };
      ctrls.appendChild(mk("↑", "move up", () => { const t = biomeRows[i - 1]; biomeRows[i - 1] = biomeRows[i]; biomeRows[i] = t; render(); }, i === 0));
      ctrls.appendChild(mk("↓", "move down", () => { const t = biomeRows[i + 1]; biomeRows[i + 1] = biomeRows[i]; biomeRows[i] = t; render(); }, i === biomeRows.length - 1));
      ctrls.appendChild(mk("✕", "remove", () => { biomeRows.splice(i, 1); render(); }));
      head.appendChild(ctrls); card.appendChild(head);

      const grid = document.createElement("div"); grid.className = "bgrid";
      grid.appendChild(biomeField(b, "key", "key", "text"));
      grid.appendChild(biomeField(b, "name", "name", "text"));
      grid.appendChild(biomeField(b, "floor sprite", "floor", "text"));
      grid.appendChild(biomeField(b, "wall sprite", "wall", "text"));
      grid.appendChild(biomeField(b, "boss", "boss", "select", [""].concat(bossKeys)));
      grid.appendChild(biomeField(b, "bossCount", "bossCount", "num"));
      grid.appendChild(biomeField(b, "door style", "door", "select", ["door", "bush"]));
      grid.appendChild(biomeField(b, "exitStyle", "exitStyle", "select", ["", "wall"]));
      grid.appendChild(biomeField(b, "exitSprite", "exitSprite", "text"));
      grid.appendChild(biomeField(b, "spawnEvery", "spawnEvery", "num"));
      grid.appendChild(biomeField(b, "spawnCap", "spawnCap", "num"));
      grid.appendChild(biomeField(b, "spawnInitial", "spawnInitial", "spawn"));
      grid.appendChild(biomeField(b, "final biome?", "final", "bool"));
      card.appendChild(grid);

      const ml = document.createElement("div"); ml.className = "bmons";
      const lbl = document.createElement("div"); lbl.className = "bmons-l"; lbl.textContent = "Monsters here:"; ml.appendChild(lbl);
      const chips = document.createElement("div"); chips.className = "chips";
      if (!Array.isArray(b.monsters)) b.monsters = [];
      for (const k of monKeys) {
        const on = b.monsters.indexOf(k) >= 0;
        const chip = document.createElement("button"); chip.className = "chip" + (on ? " on" : ""); chip.textContent = k;
        chip.onclick = () => { const idx = b.monsters.indexOf(k); if (idx >= 0) b.monsters.splice(idx, 1); else b.monsters.push(k); render(); };
        chips.appendChild(chip);
      }
      ml.appendChild(chips); card.appendChild(ml);

      // spawn mix: a weight per biome-floor (1–5) for each selected monster.
      // Blank = 1 (default), 0 = never on that floor. Higher = more common.
      if (b.monsters.length) {
        const mix = document.createElement("div"); mix.className = "bmix";
        const ml2 = document.createElement("div"); ml2.className = "bmons-l"; ml2.textContent = "Spawn mix — weight per floor (blank = 1, 0 = never, higher = more common):"; mix.appendChild(ml2);
        const hdr = document.createElement("div"); hdr.className = "bmixrow head";
        const hn = document.createElement("span"); hn.className = "bmixname"; hdr.appendChild(hn);
        for (let f = 1; f <= 5; f++) { const s = document.createElement("span"); s.className = "bmixw lbl"; s.textContent = "F" + f; hdr.appendChild(s); }
        mix.appendChild(hdr);
        b.spawnMix = b.spawnMix || {};
        for (const k of b.monsters) {
          const row = document.createElement("div"); row.className = "bmixrow";
          const name = document.createElement("span"); name.className = "bmixname"; name.textContent = k; row.appendChild(name);
          for (let f = 0; f < 5; f++) {
            const inp = document.createElement("input"); inp.type = "number"; inp.className = "bmixw"; inp.min = "0"; inp.placeholder = "1";
            const arr = b.spawnMix[k];
            inp.value = (arr && arr[f] != null) ? arr[f] : "";
            inp.oninput = () => {
              if (!Array.isArray(b.spawnMix[k])) b.spawnMix[k] = [];
              b.spawnMix[k][f] = inp.value === "" ? undefined : Number(inp.value);
            };
            row.appendChild(inp);
          }
          mix.appendChild(row);
        }
        card.appendChild(mix);
      }
      wrap.appendChild(card);
    });
    const add = document.createElement("div"); add.className = "addrow";
    const btn = document.createElement("button"); btn.textContent = "+ Add biome";
    btn.onclick = () => { biomeRows.push({ key: "new_biome", name: "New Biome", floor: "floor", wall: "wall", monsters: [], boss: bossKeys[0] || "", door: "door" }); render(); };
    add.appendChild(btn); wrap.appendChild(add);
    return wrap;
  }

  // ---- Classes: a form + a 5×5 skill-tree grid with hover tooltips -----------
  function classField(o, label, path, type, opts) {
    const wrap = document.createElement("label"); wrap.className = "cfld";
    const span = document.createElement("span"); span.textContent = label; wrap.appendChild(span);
    let inp;
    if (type === "select") {
      inp = document.createElement("select");
      for (const op of opts) { const e = document.createElement("option"); e.value = op; e.textContent = op || "(none)"; inp.appendChild(e); }
      const cur = getPath(o, path); inp.value = cur != null ? cur : (opts[0] || "");
      inp.onchange = () => setPath(o, path, inp.value === "" ? undefined : inp.value);
    } else if (type === "num") {
      inp = document.createElement("input"); inp.type = "number"; const cur = getPath(o, path); inp.value = cur != null ? cur : "";
      inp.oninput = () => setPath(o, path, inp.value === "" ? undefined : Number(inp.value));
    } else if (type === "textarea") {
      inp = document.createElement("textarea"); inp.rows = 2; inp.value = getPath(o, path) || "";
      inp.oninput = () => setPath(o, path, inp.value === "" ? undefined : inp.value);
    } else {
      inp = document.createElement("input"); inp.type = "text"; inp.value = getPath(o, path) || "";
      inp.oninput = () => setPath(o, path, inp.value === "" ? undefined : inp.value);
    }
    wrap.appendChild(inp);
    return wrap;
  }
  function renderClasses() {
    const wrap = document.createElement("div");
    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); h.textContent = "classes"; bar.appendChild(h); wrap.appendChild(bar);

    const picker = document.createElement("div"); picker.className = "cpick";
    classRows.forEach((r, i) => {
      const btn = document.createElement("button"); btn.className = "ctab2" + (i === activeClass ? " on" : ""); btn.textContent = r.key || "?";
      btn.onclick = () => { activeClass = i; render(); };
      picker.appendChild(btn);
    });
    const addC = document.createElement("button"); addC.className = "ctab2 add"; addC.textContent = "+ Add class";
    addC.onclick = () => {
      const key = uniqueKeyArr(classRows.map((r) => r.key), "new_class");
      const obj = { name: "New Class", main: "STR", secondary: "VIT", unlock: "town", baseMp: 0, blurb: "" };
      ensureClass(obj); classRows.push({ key, obj }); activeClass = classRows.length - 1; render();
    };
    picker.appendChild(addC); wrap.appendChild(picker);
    if (!classRows.length) return wrap;

    const cr = classRows[activeClass]; const o = cr.obj;
    const gearWeapons = rows.gear.filter((r) => r.obj.cat === "weapon").map((r) => r.key);
    const gearArmor = rows.gear.filter((r) => r.obj.cat === "armor").map((r) => r.key);

    const del = document.createElement("div"); del.style.margin = "0 0 10px";
    const delBtn = document.createElement("button"); delBtn.className = "del"; delBtn.textContent = "✕ delete this class";
    delBtn.onclick = () => { classRows.splice(activeClass, 1); activeClass = Math.max(0, activeClass - 1); render(); };
    del.appendChild(delBtn); wrap.appendChild(del);

    // key + core fields
    const form = document.createElement("div"); form.className = "cform";
    const keyWrap = document.createElement("label"); keyWrap.className = "cfld";
    const ks = document.createElement("span"); ks.textContent = "key"; keyWrap.appendChild(ks);
    const ki = document.createElement("input"); ki.type = "text"; ki.value = cr.key; ki.oninput = () => { cr.key = ki.value.trim(); }; keyWrap.appendChild(ki);
    form.appendChild(keyWrap);
    form.appendChild(classField(o, "name", "name", "text"));
    form.appendChild(classField(o, "main stat", "main", "select", STAT_KEYS));
    form.appendChild(classField(o, "secondary stat", "secondary", "select", STAT_KEYS));
    form.appendChild(classField(o, "unlock", "unlock", "select", ["start", "town"]));
    form.appendChild(classField(o, "start weapon", "start.weapon", "select", [""].concat(gearWeapons)));
    form.appendChild(classField(o, "start armor", "start.armor", "select", [""].concat(gearArmor)));
    wrap.appendChild(form);

    // base stats — the six stats plus base HP and MP
    const sh = document.createElement("h3"); sh.className = "csec"; sh.textContent = "Base stats"; wrap.appendChild(sh);
    const sg = document.createElement("div"); sg.className = "cform";
    for (const k of STAT_KEYS) sg.appendChild(classField(o, k, "stats." + k, "num"));
    sg.appendChild(classField(o, "HP", "baseHp", "num"));
    sg.appendChild(classField(o, "MP", "baseMp", "num"));
    wrap.appendChild(sg);
    const snote = document.createElement("p"); snote.className = "hint";
    snote.textContent = "Total HP = base HP + 1 per VIT (blank HP defaults to 13). MP is the base MP pool.";
    wrap.appendChild(snote);

    // regeneration
    const rh = document.createElement("h3"); rh.className = "csec"; rh.textContent = "Regen"; wrap.appendChild(rh);
    const rg = document.createElement("div"); rg.className = "cform";
    rg.appendChild(classField(o, "base turns to full HP", "regenTurns", "num"));
    rg.appendChild(classField(o, "VIT regen factor", "vitRegen", "num"));
    rg.appendChild(classField(o, "base turns to full MP", "mpRegenTurns", "num"));
    rg.appendChild(classField(o, "INT regen factor", "intRegen", "num"));
    wrap.appendChild(rg);
    const rnote = document.createElement("p"); rnote.className = "hint";
    rnote.textContent = "It takes “base turns to full” turns to regen from empty to full, minus (stat × factor) — VIT speeds HP, INT speeds MP. Defaults 600 turns, factor 2.";
    wrap.appendChild(rnote);

    // per-level bonuses
    const lh = document.createElement("h3"); lh.className = "csec"; lh.textContent = "Per-level bonuses (levelUp)"; wrap.appendChild(lh);
    const lg = document.createElement("div"); lg.className = "cform";
    lg.appendChild(classField(o, "HP", "levelUp.hp", "num"));
    lg.appendChild(classField(o, "MP", "levelUp.mp", "num"));
    lg.appendChild(classField(o, "accuracy", "levelUp.accuracy", "num"));
    lg.appendChild(classField(o, "evasion", "levelUp.evasion", "num"));
    lg.appendChild(classField(o, "crit % (added)", "levelUp.crit", "num"));
    lg.appendChild(classField(o, "crit dmg % (added)", "levelUp.critDmg", "num"));
    wrap.appendChild(lg);
    const lnote = document.createElement("p"); lnote.className = "hint";
    lnote.textContent = "Added each level. Base crit is 5% for 200% damage; crit % and crit dmg % add to those.";
    wrap.appendChild(lnote);

    const bh = document.createElement("h3"); bh.className = "csec"; bh.textContent = "Blurb"; wrap.appendChild(bh);
    const bg = document.createElement("div"); bg.className = "cform"; const bf = classField(o, "shown in class select", "blurb", "textarea"); bf.style.gridColumn = "1 / -1"; bg.appendChild(bf); wrap.appendChild(bg);

    // 5×5 skill tree (Diablo-style: cells are a skill or a blank space)
    const th = document.createElement("h3"); th.className = "csec"; th.textContent = "Skill tree — 5 tiers × 5 slots"; wrap.appendChild(th);
    const tnote = document.createElement("p"); tnote.className = "hint";
    tnote.textContent = "Leave slots blank to shape the tree. Each skill has a description, up to 4 level notes (the dots show how high it goes), prerequisites (other skills taken first), and a wiring row: key (engine id), icon, behavior (passive / rush / spin), and when (a weapon subtype a passive needs, e.g. axe). A skill only works in-game once it has per-level mechanics — edit those (the ranks array) in the </> code view. Warrior's Rush, Spin and Axe Master are fully wired examples.";
    wrap.appendChild(tnote);
    const allSkills = [];   // gather named skills for the prereq picker
    for (let t = 0; t < TIERS; t++) for (let s = 0; s < SLOTS; s++) { const c = o.skillTree[t][s]; if (c && c.name) allSkills.push({ t, s, name: c.name }); }
    const tree = document.createElement("div"); tree.className = "stree";
    for (let t = 0; t < TIERS; t++) {
      const rowEl = document.createElement("div"); rowEl.className = "strow";
      const tl = document.createElement("div"); tl.className = "stier"; tl.textContent = "Tier " + (t + 1); rowEl.appendChild(tl);
      for (let s = 0; s < SLOTS; s++) rowEl.appendChild(renderSkillCell(o, t, s, allSkills));
      tree.appendChild(rowEl);
    }
    wrap.appendChild(tree);
    return wrap;
  }
  function renderSkillCell(o, t, s, allSkills) {
    const cell = o.skillTree[t][s];
    const box = document.createElement("div"); box.className = "scell" + (cell ? " filled" : " blank");
    if (!cell) {
      const add = document.createElement("button"); add.className = "sadd"; add.textContent = "+";
      add.title = "add a skill here";
      add.onclick = () => { o.skillTree[t][s] = { name: "New Skill", desc: "", levels: ["", ""], req: [] }; render(); };
      box.appendChild(add);
      return box;
    }
    // header: name + flip-to-code + remove
    const fkey = activeClass + ":" + t + "," + s;
    const head = document.createElement("div"); head.className = "shead";
    const nm = document.createElement("input"); nm.className = "sname"; nm.type = "text"; nm.value = cell.name || ""; nm.placeholder = "name";
    nm.oninput = () => { cell.name = nm.value; };
    const flip = document.createElement("button"); flip.className = "bbtn flip"; flip.textContent = flippedSkill.has(fkey) ? "▦" : "</>"; flip.title = "flip between the form and raw JSON";
    flip.onclick = () => { if (flippedSkill.has(fkey)) flippedSkill.delete(fkey); else flippedSkill.add(fkey); render(); };
    const rm = document.createElement("button"); rm.className = "bbtn"; rm.textContent = "✕"; rm.title = "clear slot";
    rm.onclick = () => { flippedSkill.delete(fkey); o.skillTree[t][s] = null; render(); };
    head.appendChild(nm); head.appendChild(flip); head.appendChild(rm); box.appendChild(head);
    if (flippedSkill.has(fkey)) { box.appendChild(codeEditor(cell, (parsed) => { o.skillTree[t][s] = parsed; })); return box; }
    // description
    const dsc = document.createElement("textarea"); dsc.className = "sdesc"; dsc.rows = 2; dsc.placeholder = "in-game description"; dsc.value = cell.desc || "";
    dsc.oninput = () => { cell.desc = dsc.value; };
    box.appendChild(dsc);
    // engine wiring: key + icon + behavior + condition. The per-level mechanics
    // (the `ranks` array) live in the </> code view — this row makes the skill real.
    const wire = document.createElement("div"); wire.className = "swire";
    const mkIn = (ph, f) => { const i = document.createElement("input"); i.type = "text"; i.placeholder = ph; i.value = cell[f] || ""; i.oninput = () => { if (!i.value) delete cell[f]; else cell[f] = i.value.trim(); }; return i; };
    wire.appendChild(mkIn("key", "key"));
    wire.appendChild(mkIn("icon", "icon"));
    const kind = document.createElement("select");
    for (const k of ["passive", "rush", "spin"]) { const op = document.createElement("option"); op.value = k; op.textContent = k; kind.appendChild(op); }
    kind.value = cell.kind || "passive";
    kind.onchange = () => { cell.kind = kind.value; };
    wire.appendChild(kind);
    wire.appendChild(mkIn("when (e.g. axe)", "when"));
    box.appendChild(wire);
    // 4 level rows + dots
    const dots = document.createElement("div"); dots.className = "sdots";
    const refreshDots = () => {
      dots.innerHTML = "";
      const maxLv = (cell.levels || []).filter((x) => x && x.trim()).length;
      for (let i = 0; i < 4; i++) { const d = document.createElement("span"); d.className = "sdot" + (i < maxLv ? " on" : ""); dots.appendChild(d); }
    };
    const lvWrap = document.createElement("div"); lvWrap.className = "slevels";
    for (let i = 0; i < 4; i++) {
      const row = document.createElement("div"); row.className = "slvrow";
      const lab = document.createElement("span"); lab.className = "slvl"; lab.textContent = "L" + (i + 1);
      const inp = document.createElement("input"); inp.type = "text"; inp.placeholder = "what level " + (i + 1) + " does"; inp.value = (cell.levels && cell.levels[i]) || "";
      inp.oninput = () => { cell.levels = cell.levels || []; cell.levels[i] = inp.value; while (cell.levels.length && !cell.levels[cell.levels.length - 1]) cell.levels.pop(); refreshDots(); };
      row.appendChild(lab); row.appendChild(inp); lvWrap.appendChild(row);
    }
    box.appendChild(lvWrap);
    box.appendChild(dots); refreshDots();
    // prerequisites: chips of every OTHER named skill
    const others = allSkills.filter((k) => !(k.t === t && k.s === s));
    if (others.length) {
      const pr = document.createElement("div"); pr.className = "sprereq";
      const l = document.createElement("div"); l.className = "bmons-l"; l.textContent = "Requires:"; pr.appendChild(l);
      const chips = document.createElement("div"); chips.className = "chips";
      cell.req = cell.req || [];
      const has = (k) => cell.req.some((r) => r[0] === k.t && r[1] === k.s);
      for (const k of others) {
        const chip = document.createElement("button"); chip.className = "chip" + (has(k) ? " on" : ""); chip.textContent = k.name;
        chip.onclick = () => {
          const idx = cell.req.findIndex((r) => r[0] === k.t && r[1] === k.s);
          if (idx >= 0) cell.req.splice(idx, 1); else cell.req.push([k.t, k.s]);
          chip.classList.toggle("on");
        };
        chips.appendChild(chip);
      }
      pr.appendChild(chips); box.appendChild(pr);
    }
    return box;
  }

  // ---- Enchants: table with proc rate + slot chips ---------------------------
  function renderEnchants() {
    const wrap = document.createElement("div");
    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); h.textContent = "enchants — " + enchantRows.length; bar.appendChild(h); wrap.appendChild(bar);
    const note = document.createElement("p"); note.className = "hint";
    note.textContent = "On-hit procs rolled onto gear (blue+). proc = chance (0–1) it fires per hit. Slots = which item types it can roll on. The Effect block drives what it DOES (a type + numbers the engine reads directly), and the description is shown to the player. Hit “</> code” to edit the whole enchant as raw JSON.";
    wrap.appendChild(note);
    enchantRows.forEach((r, i) => {
      const o = r.obj;
      const card = document.createElement("div"); card.className = "bcard";
      const head = document.createElement("div"); head.className = "bhead";
      const t = document.createElement("b"); t.textContent = (o.icon || "") + " " + (r.key || "?"); head.appendChild(t);
      const hr = document.createElement("span"); hr.className = "bhead-r";
      const flip = document.createElement("button"); flip.className = "bbtn flip"; flip.textContent = flippedEnch.has(r) ? "▦ form" : "</> code"; flip.title = "flip between the form and raw JSON";
      flip.onclick = () => { if (flippedEnch.has(r)) flippedEnch.delete(r); else flippedEnch.add(r); render(); };
      const del = document.createElement("button"); del.className = "bbtn"; del.textContent = "✕"; del.title = "remove";
      del.onclick = () => { flippedEnch.delete(r); enchantRows.splice(i, 1); render(); };
      hr.appendChild(flip); hr.appendChild(del); head.appendChild(hr); card.appendChild(head);
      if (flippedEnch.has(r)) { card.appendChild(codeEditor(o, (parsed) => { r.obj = parsed; })); wrap.appendChild(card); return; }
      const grid = document.createElement("div"); grid.className = "bgrid";
      const fld = (label, f, type, opts) => {
        const w = document.createElement("label"); w.className = "bfield";
        const s = document.createElement("span"); s.textContent = label; w.appendChild(s);
        let inp;
        if (type === "color") { inp = document.createElement("input"); inp.type = "color"; inp.value = normHex(o[f]) || "#cccccc"; inp.oninput = () => { o[f] = inp.value; }; }
        else if (type === "num") { inp = document.createElement("input"); inp.type = "number"; inp.step = "0.05"; inp.value = o[f] != null ? o[f] : ""; inp.oninput = () => { if (inp.value === "") delete o[f]; else o[f] = Number(inp.value); }; }
        else if (f === "__key") { inp = document.createElement("input"); inp.type = "text"; inp.value = r.key; inp.oninput = () => { r.key = inp.value.trim(); }; }
        else { inp = document.createElement("input"); inp.type = "text"; inp.value = o[f] != null ? o[f] : ""; inp.oninput = () => { if (inp.value === "") delete o[f]; else o[f] = inp.value; }; }
        w.appendChild(inp); return w;
      };
      grid.appendChild(fld("key", "__key", "text"));
      grid.appendChild(fld("name", "name", "text"));
      grid.appendChild(fld("icon", "icon", "text"));
      grid.appendChild(fld("color", "color", "color"));
      grid.appendChild(fld("proc rate (0–1)", "proc", "num"));
      card.appendChild(grid);
      const dwrap = document.createElement("label"); dwrap.className = "bfield wide";
      const dl = document.createElement("span"); dl.textContent = "description (shown to the player)"; dwrap.appendChild(dl);
      const dta = document.createElement("textarea"); dta.className = "edesc"; dta.rows = 2; dta.value = o.desc || "";
      dta.oninput = () => { if (!dta.value) delete o.desc; else o.desc = dta.value; };
      dwrap.appendChild(dta); card.appendChild(dwrap);
      card.appendChild(renderEffect(o));
      const ml = document.createElement("div"); ml.className = "bmons";
      const lbl = document.createElement("div"); lbl.className = "bmons-l"; lbl.textContent = "Can appear on:"; ml.appendChild(lbl);
      const chips = document.createElement("div"); chips.className = "chips";
      if (!Array.isArray(o.slots)) o.slots = GEAR_CATS.slice();
      for (const cat of GEAR_CATS) {
        const on = o.slots.indexOf(cat) >= 0;
        const chip = document.createElement("button"); chip.className = "chip" + (on ? " on" : ""); chip.textContent = cat;
        chip.onclick = () => { const idx = o.slots.indexOf(cat); if (idx >= 0) o.slots.splice(idx, 1); else o.slots.push(cat); chip.classList.toggle("on"); };
        chips.appendChild(chip);
      }
      ml.appendChild(chips); card.appendChild(ml);
      wrap.appendChild(card);
    });
    const add = document.createElement("div"); add.className = "addrow";
    const btn = document.createElement("button"); btn.textContent = "+ Add enchant";
    btn.onclick = () => { enchantRows.push({ key: uniqueKeyArr(enchantRows.map((r) => r.key), "new_enchant"), obj: { name: "New Enchant", icon: "✦", color: "#cccccc", proc: 0.3, slots: GEAR_CATS.slice(), desc: "", effect: { type: "burn", burstMult: 0.5, dotTurns: 3 } } }); render(); };
    add.appendChild(btn); wrap.appendChild(add);
    return wrap;
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
    // enchants come from their own tab, merged back into loot
    out.loot = out.loot || {};
    const eo = {}; const seenE = {};
    for (const { key, obj } of enchantRows) {
      if (!key) { problems.push("an enchant has an empty key"); continue; }
      if (seenE[key]) problems.push("enchants: duplicate key “" + key + "”");
      seenE[key] = 1; eo[key] = obj;
    }
    out.loot.enchants = eo;
    out.biomes = clone(biomeRows);                    // biomes come from the card editor
    biomeRows.forEach((b, i) => { if (!b.key) problems.push("biome " + (i + 1) + " has an empty key"); });
    // tidy each biome's spawn mix: drop weights for unselected monsters and any
    // row that's entirely default (all blank / all 1), and drop an empty mix.
    for (const b of out.biomes) {
      if (!b.spawnMix) continue;
      const mons = Array.isArray(b.monsters) ? b.monsters : [];
      for (const k of Object.keys(b.spawnMix)) {
        const a = b.spawnMix[k];
        const meaningful = mons.indexOf(k) >= 0 && Array.isArray(a) && a.some((w) => w != null && Number(w) !== 1);
        if (!meaningful) delete b.spawnMix[k];
        else b.spawnMix[k] = a.slice(0, 5).map((w) => (w == null ? null : Number(w)));
      }
      if (!Object.keys(b.spawnMix).length) delete b.spawnMix;
    }

    out.classes = {};                                 // classes come from the form + skill grid
    const seenC = {};
    for (const { key, obj } of classRows) {
      if (!key) { problems.push("a class has an empty key"); continue; }
      if (seenC[key]) problems.push("classes: duplicate key “" + key + "”");
      seenC[key] = 1;
      const c = clone(obj);
      // compress the skill grid: fully-blank cells → null (kept as scaffold, small on
      // disk). A filled cell keeps ALL its fields — so any governing code written via
      // the flip-to-JSON view survives — with the known ones normalized.
      if (Array.isArray(c.skillTree)) c.skillTree = c.skillTree.map((tier) => tier.map((cell) => {
        if (!cell || !cell.name) return null;
        cell.desc = cell.desc || "";
        cell.levels = (cell.levels || []).slice(0, 4);
        cell.req = cell.req || [];
        return cell;
      }));
      out.classes[key] = c;
    }
    return { data: out, problems };
  }

  function dataFileText(data) {
    return "/* Cantori content data — generated by editor.html. Edit via the editor,\n" +
           "   or by hand (it's plain data). The game loads window.CANTORI_DATA. */\n" +
           "window.CANTORI_DATA = " + JSON.stringify(data, null, 2) + ";\n";
  }

  // ---- Save straight to GitHub (commits data.js via the API) -----------------
  const GH_CFG = "cantori_gh_cfg", GH_TOK = "cantori_gh_token";
  const GH_DEFAULTS = { owner: "thebigbutsu", repo: "Cantori", branch: "claude/mobile-iphone-support-plan-kp1qqh", path: "data.js" };
  function ghCfg() { try { return Object.assign({}, GH_DEFAULTS, JSON.parse(localStorage.getItem(GH_CFG) || "{}")); } catch (e) { return Object.assign({}, GH_DEFAULTS); } }
  function ghToken() { try { return localStorage.getItem(GH_TOK) || ""; } catch (e) { return ""; } }
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ""; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function ghMsg(m, k) { const e = $("ghMsg"); e.textContent = m; e.className = k || ""; }
  function reflectGhButton() { $("btnGh").classList.toggle("on", !!ghToken()); }
  function openGh() {
    const c = ghCfg();
    $("ghOwner").value = c.owner; $("ghRepo").value = c.repo; $("ghBranch").value = c.branch; $("ghPath").value = c.path;
    $("ghToken").value = ghToken();
    $("ghState").textContent = ghToken() ? "Token saved in this browser — you're connected." : "No token yet — paste one below to connect.";
    ghMsg("", "");
    $("ghDlg").showModal();
  }
  function ghSaveCfg() {
    const c = { owner: $("ghOwner").value.trim(), repo: $("ghRepo").value.trim(), branch: $("ghBranch").value.trim(), path: $("ghPath").value.trim() };
    try { localStorage.setItem(GH_CFG, JSON.stringify(c)); } catch (e) {}
    return c;
  }
  function ghSaveToken() {
    const t = $("ghToken").value.trim();
    try { if (t) localStorage.setItem(GH_TOK, t); else localStorage.removeItem(GH_TOK); } catch (e) {}
    $("ghState").textContent = t ? "Token saved in this browser — you're connected." : "No token.";
    reflectGhButton(); ghMsg("Saved.", "ok");
  }
  function ghForget() {
    try { localStorage.removeItem(GH_TOK); } catch (e) {}
    $("ghToken").value = ""; $("ghState").textContent = "No token."; reflectGhButton(); ghMsg("Token forgotten.", "ok");
  }
  async function ghCommit() {
    const { data, problems } = buildData();
    if (problems.length) { ghMsg("Fix: " + problems[0], "err"); return; }
    const c = ghSaveCfg();
    const token = $("ghToken").value.trim();
    if (token) { try { localStorage.setItem(GH_TOK, token); } catch (e) {} reflectGhButton(); }
    if (!token) { ghMsg("Enter a token first.", "err"); return; }
    if (!c.owner || !c.repo || !c.branch || !c.path) { ghMsg("Fill in owner / repo / branch / path.", "err"); return; }
    ghMsg("Committing…", "");
    const api = "https://api.github.com/repos/" + c.owner + "/" + c.repo + "/contents/" + c.path;
    const headers = { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const content = utf8ToBase64(dataFileText(data));
    // Fetch the file's current blob SHA WITHOUT the HTTP cache — a cached GET
    // returns a stale SHA and GitHub then rejects the PUT with a 409.
    async function currentSha() {
      const getRes = await fetch(api + "?ref=" + encodeURIComponent(c.branch) + "&_=" + Date.now(), { headers, cache: "no-store" });
      if (getRes.ok) return (await getRes.json()).sha;
      if (getRes.status === 404) return null;
      throw new Error("read " + getRes.status + " — " + (await getRes.text()).slice(0, 140));
    }
    async function put(sha) {
      const body = { message: "Edit " + c.path + " via Cantori editor", content: content, branch: c.branch };
      if (sha) body.sha = sha;
      return fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
    }
    try {
      let putRes = await put(await currentSha());
      // 409 = the SHA moved under us (another commit, or a cached SHA). Re-read
      // the live SHA once and retry so a stale read doesn't block the save.
      if (putRes.status === 409) { ghMsg("Refreshing…", ""); putRes = await put(await currentSha()); }
      if (!putRes.ok) { throw new Error("commit " + putRes.status + " — " + (await putRes.text()).slice(0, 180)); }
      ghMsg("Committed! GitHub Pages redeploys in ~1 min.", "ok");
      setStatus("Committed " + c.path + " to " + c.owner + "/" + c.repo + " (" + c.branch + ").", "ok");
    } catch (e) {
      ghMsg("Failed: " + e.message, "err");
    }
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
    for (const c of JSON_COLLS) { let s = source[c] != null ? source[c] : {}; if (c === "loot") { s = Object.assign({}, s); delete s.enchants; } jsonText[c] = JSON.stringify(s, null, 2); jsonOk[c] = true; }
    enchantRows = Object.entries((source.loot && source.loot.enchants) || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
    biomeRows = clone(source.biomes || []);
    classRows = Object.entries(source.classes || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
    classRows.forEach((r) => ensureClass(r.obj)); activeClass = 0;
    render();
    setStatus("Reverted to shipped content.", "ok");
  }

  // ---- Helpers ---------------------------------------------------------------
  function uniqueKey(coll, base) { return uniqueKeyArr(rows[coll].map((r) => r.key), base); }
  function uniqueKeyArr(keys, base) {
    const taken = {}; for (const k of keys) taken[k] = 1;
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
      gear: "cat sets the equip slot; subtype classifies it (weapons: dagger/sword/axe/spear/bow — armor: light/medium/heavy). WEAPONS use dmg min/max, speed, and acc; ARMOR uses def min/max (each hit blocks a random amount in that range); JEWELRY uses neither (value = rolled affixes). speed = attacks per turn: >1 attacks faster (cost 1/speed), <1 slower. range = reach: blank/1 is melee, 2+ lets you tap a monster that far away with line of sight to strike (spear 2, bow 5). Armor subtype nudges evasion: light +2, medium 0, heavy −3. tier drives affix size AND groups drops. rarity % = this type's drop chance within its tier+category; blank = a 'default' that splits the remaining %. Tier-by-floor and category odds live in the Loot tab. Sprites: assets/tiles/<key>.png, else the glyph.",
      consumables: "effect is what it does: heal, strength, poison, map, teleport, burn. Droppable potions/scrolls appear as loot at equal odds; tick 'no drop' to keep one out of the pool (e.g. the torch).",
      bosses: "One boss guards floor 5 of each biome. Which biome uses which boss is set on the Biomes tab.",
    })[coll] || "";
  }
  function jsonHint(coll) {
    return ({
      biomes: "Ordered list of the 5 biomes. Each: key, name, floor/wall sprite names, monsters (keys), boss (a bosses key), optional bossCount, spawnInitial/spawnEvery/spawnCap, exitStyle/exitSprite, door (\"bush\"/\"door\"), final.",
      classes: "Player classes and their starting kit + skill trees. Edited as JSON for now (nested structure).",
      loot: "Rarity table, stat pool, and tier-by-floor bands. dropWeights = the gold/gear/consumable split of a floor's random drops (favour gear so weapons aren't drowned out). categoryWeights = odds of each gear slot (no trinket — trinkets are boss-only). trinketRarity = the blue/purple/gold floor for boss trinkets. (Enchants have their own tab.)",
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
  $("btnGh").onclick = openGh;
  $("ghClose").onclick = () => $("ghDlg").close();
  $("ghSave").onclick = ghCommit;
  $("ghSaveToken").onclick = ghSaveToken;
  $("ghForget").onclick = ghForget;

  render();
  refreshDraftButtons();
  reflectGhButton();
  setStatus(draftActive() ? "Editing a saved draft (Playtest active)." : "Loaded shipped content.", "ok");
})();
