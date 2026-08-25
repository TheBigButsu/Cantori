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
  const TABS = TABLE_COLLS.concat(["biomes", "classes"]).concat(JSON_COLLS);   // biomes & classes = custom editors
  const STAT_KEYS = ["STR", "INT", "VIT", "DEX", "RES", "LCK"];
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
  let biomeRows = clone(source.biomes || []);   // biomes are an ordered array of cards
  let classRows = Object.entries(source.classes || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
  let activeClass = 0;
  // Normalize a class: ensure stats/start/levelUp exist and pad the skill tree to a
  // full 5×5 grid of {name, desc} cells (blank to start).
  function ensureClass(obj) {
    obj.stats = Object.assign({ STR: 5, INT: 5, VIT: 5, DEX: 5, RES: 5, LCK: 5 }, obj.stats || {});
    obj.start = obj.start || {};
    obj.levelUp = obj.levelUp || {};
    if (!Array.isArray(obj.skillTree)) obj.skillTree = [];
    for (let t = 0; t < TIERS; t++) {
      if (!Array.isArray(obj.skillTree[t])) obj.skillTree[t] = [];
      for (let s = 0; s < SLOTS; s++) if (!obj.skillTree[t][s]) obj.skillTree[t][s] = { name: "", desc: "" };
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
    else if (activeTab === "biomes") main.appendChild(renderBiomes());
    else if (activeTab === "classes") main.appendChild(renderClasses());
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
    note.textContent = "The biomes in depth order (each is 5 floors). Monsters = which creatures can spawn here (click to toggle; a monster also needs a minFloor on the Monsters tab to actually appear). spawnInitial = how many spawn on a fresh floor — one number, or per-floor like 3,5,5,5. exitStyle \"wall\" carves the exit into the border; blank = stairs.";
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
        chip.onclick = () => { const idx = b.monsters.indexOf(k); if (idx >= 0) b.monsters.splice(idx, 1); else b.monsters.push(k); chip.classList.toggle("on"); };
        chips.appendChild(chip);
      }
      ml.appendChild(chips); card.appendChild(ml);
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
    form.appendChild(classField(o, "base MP", "baseMp", "num"));
    wrap.appendChild(form);

    // base stats
    const sh = document.createElement("h3"); sh.className = "csec"; sh.textContent = "Base stats"; wrap.appendChild(sh);
    const sg = document.createElement("div"); sg.className = "cform";
    for (const k of STAT_KEYS) sg.appendChild(classField(o, k, "stats." + k, "num"));
    wrap.appendChild(sg);

    // per-level bonuses
    const lh = document.createElement("h3"); lh.className = "csec"; lh.textContent = "Per-level bonuses (levelUp)"; wrap.appendChild(lh);
    const lg = document.createElement("div"); lg.className = "cform";
    lg.appendChild(classField(o, "HP", "levelUp.hp", "num"));
    lg.appendChild(classField(o, "MP", "levelUp.mp", "num"));
    lg.appendChild(classField(o, "accuracy", "levelUp.accuracy", "num"));
    lg.appendChild(classField(o, "evasion", "levelUp.evasion", "num"));
    wrap.appendChild(lg);

    const bh = document.createElement("h3"); bh.className = "csec"; bh.textContent = "Blurb"; wrap.appendChild(bh);
    const bg = document.createElement("div"); bg.className = "cform"; const bf = classField(o, "shown in class select", "blurb", "textarea"); bf.style.gridColumn = "1 / -1"; bg.appendChild(bf); wrap.appendChild(bg);

    // 5×5 skill tree
    const th = document.createElement("h3"); th.className = "csec"; th.textContent = "Skill tree — 5 tiers × 5 options (hover a skill to read it)"; wrap.appendChild(th);
    const tree = document.createElement("div"); tree.className = "stree";
    for (let t = 0; t < TIERS; t++) {
      const rowEl = document.createElement("div"); rowEl.className = "strow";
      const tl = document.createElement("div"); tl.className = "stier"; tl.textContent = "Tier " + (t + 1); rowEl.appendChild(tl);
      for (let s = 0; s < SLOTS; s++) {
        const cell = o.skillTree[t][s];
        const box = document.createElement("div"); box.className = "scell" + (cell.name ? " filled" : "");
        const nm = document.createElement("input"); nm.className = "sname"; nm.type = "text"; nm.placeholder = "empty"; nm.value = cell.name || "";
        const dsc = document.createElement("textarea"); dsc.className = "sdesc"; dsc.rows = 2; dsc.placeholder = "description"; dsc.value = cell.desc || "";
        const tip = document.createElement("div"); tip.className = "stip";
        const setTip = () => { tip.textContent = cell.name ? (cell.name + (cell.desc ? " — " + cell.desc : "")) : "(empty skill slot)"; };
        setTip();
        nm.oninput = () => { cell.name = nm.value; box.classList.toggle("filled", !!nm.value); setTip(); };
        dsc.oninput = () => { cell.desc = dsc.value; setTip(); };
        box.appendChild(nm); box.appendChild(dsc); box.appendChild(tip);
        rowEl.appendChild(box);
      }
      tree.appendChild(rowEl);
    }
    wrap.appendChild(tree);
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
    out.biomes = clone(biomeRows);                    // biomes come from the card editor
    biomeRows.forEach((b, i) => { if (!b.key) problems.push("biome " + (i + 1) + " has an empty key"); });

    out.classes = {};                                 // classes come from the form + skill grid
    const seenC = {};
    for (const { key, obj } of classRows) {
      if (!key) { problems.push("a class has an empty key"); continue; }
      if (seenC[key]) problems.push("classes: duplicate key “" + key + "”");
      seenC[key] = 1;
      const c = clone(obj);
      // compress the skill grid: fully-blank cells → null (kept as scaffold, small on disk)
      if (Array.isArray(c.skillTree)) c.skillTree = c.skillTree.map((tier) => tier.map((cell) => (cell && (cell.name || cell.desc)) ? { name: cell.name || "", desc: cell.desc || "" } : null));
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
    try {
      let sha = null;
      const getRes = await fetch(api + "?ref=" + encodeURIComponent(c.branch), { headers });
      if (getRes.ok) { sha = (await getRes.json()).sha; }
      else if (getRes.status !== 404) { throw new Error("read " + getRes.status + " — " + (await getRes.text()).slice(0, 140)); }
      const body = { message: "Edit " + c.path + " via Cantori editor", content: utf8ToBase64(dataFileText(data)), branch: c.branch };
      if (sha) body.sha = sha;
      const putRes = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
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
    for (const c of JSON_COLLS) { jsonText[c] = JSON.stringify(source[c] != null ? source[c] : {}, null, 2); jsonOk[c] = true; }
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
