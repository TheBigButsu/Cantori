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

  const LSTIME = "cantori_data_override_at";   // when that draft was stashed
  // Load working source: an in-progress draft if one exists, else the shipped data.
  //
  // A leftover draft silently OUTRANKS the shipped data — and a draft is created by
  // the Playtest button, so one click months ago is enough. Nothing clears it: not a
  // reload, not a HARD reload, because localStorage is not the HTTP cache. That is
  // the trap. This is the one thing that can make a freshly-reloaded editor show
  // content from days ago while the game and the repo have both moved on.
  //
  // The draft still wins (losing someone's half-finished work would be worse), but
  // never quietly: `dataSource` drives a permanent badge in the header and, when the
  // draft disagrees with what shipped, a banner offering to drop it.
  let source, dataSource = "shipped", draftAt = 0;
  try {
    const d = localStorage.getItem(LSKEY);
    if (d) {
      source = JSON.parse(d);
      dataSource = "draft";
      draftAt = Number(localStorage.getItem(LSTIME)) || 0;
    } else source = clone(SHIPPED);
  } catch (e) { source = clone(SHIPPED); }
  const staleDraft = dataSource === "draft" && JSON.stringify(source) !== JSON.stringify(SHIPPED);

  const TABLE_COLLS = ["monsters", "gear", "consumables", "bosses", "boons"];
  const JSON_COLLS = ["loot", "stats", "gods"];
  const TABS = TABLE_COLLS.concat(["biomes", "classes", "enchants"]).concat(JSON_COLLS).concat(["reference"]);
  const STAT_KEYS = ["STR", "INT", "VIT", "DEX", "RES", "LCK"];
  const GEAR_CATS = ["weapon", "armor", "ring", "trinket", "necklace"];
  const TIERS = 5, SLOTS = 5;   // skill tree: the 5×5 grid — 5 tiers of 5 slots
  // A row IS a tier, and a tier is gated on character level: tier 1 from the
  // start, tier 2 at 5, tier 3 at 10, and so on. game.js derives the same gate
  // from a node's y, so moving a skill down a row is how you make it cost more
  // levels — there is no per-node field for it and nothing to keep in sync.
  const TIER_LEVELS = 5;
  const tierLevel = (y) => (y > 0 ? y * TIER_LEVELS : 0);

  // Column specs for the table editors. type: key|text|num|bool|color|select.
  const SPECS = {
    monsters: [
      { f: "__key", label: "key", type: "key" },
      { f: "name", type: "text", cls: "name" },
      { f: "hp", type: "num" }, { f: "atkMin", type: "num" }, { f: "atkMax", type: "num" },
      { f: "speed", type: "num", step: "0.1" },
      { f: "walkSpeed", label: "walk spd", type: "num", step: "0.1" },
      { f: "attackSpeed", label: "atk spd", type: "num", step: "0.1" },
      { f: "toHit", label: "to-hit", type: "num" }, { f: "ac", label: "AC", type: "num" },
      { f: "range", type: "num" }, { f: "minFloor", type: "num" },
      { f: "charge", type: "bool" }, { f: "ranged", type: "bool" }, { f: "flying", type: "bool" },
      { f: "glyph", type: "text" }, { f: "color", type: "color" },
    ],
    // The abilities half of the monsters tab. Same rows as `monsters` — this is a
    // second view of them, not a second collection — so that the stat table stays
    // scannable instead of growing sixteen mostly-blank columns. Everything here is
    // a plain scalar: the engine reads these straight off the row.
    monsterAbilities: [
      { f: "__key", label: "key", type: "key" },
      { f: "name", type: "text", cls: "name" },
      { f: "auraRange", label: "aura range", type: "num" },
      { f: "auraWalk", label: "aura ×step", type: "num", step: "0.1" },
      { f: "auraAttack", label: "aura ×swing", type: "num", step: "0.1" },
      { f: "auraName", label: "aura name", type: "text" },
      { f: "auraColor", label: "aura colour", type: "color" },
      { f: "burstRadius", label: "burst r", type: "num" },
      { f: "burstDmg", label: "burst dmg", type: "num" },
      { f: "burstBurn", label: "burn %", type: "num" },
      { f: "burstPoison", label: "poison %", type: "num" },
      { f: "burstMp", label: "MP %", type: "num" },
      { f: "burstStunMin", label: "stun min", type: "num" },
      { f: "burstStunMax", label: "stun max", type: "num" },
      { f: "hexChance", label: "hex %", type: "num" },
      { f: "hexes", label: "hexes", type: "text", cls: "name" },
    ],
    gear: [
      { f: "__key", label: "key", type: "key" },
      { f: "cat", type: "select", opts: ["weapon", "armor", "ring", "trinket", "necklace"] },
      { f: "sub", label: "subtype", type: "select", opts: ["", "dagger", "sword", "axe", "spear", "bow", "light", "medium", "heavy"] },
      { f: "name", type: "text", cls: "name" },
      { f: "dmgMin", label: "dmg min", type: "num" }, { f: "dmgMax", label: "dmg max", type: "num" },
      { f: "speed", type: "num", step: "0.1" }, { f: "toHit", label: "to-hit", type: "num" },
      { f: "range", type: "num" },
      { f: "defMin", label: "def min", type: "num" }, { f: "defMax", label: "def max", type: "num" },
      { f: "tier", type: "num" }, { f: "rarity", label: "rarity %", type: "num" },
      { f: "reqSTR", label: "req STR", type: "num" },
      { f: "glyph", type: "text" }, { f: "color", type: "color" },
    ],
    // Armour's own column set. There is no AC column: armour grants no flat AC.
    // The SUBTYPE decides what a piece is for — light pays in INT/MP, medium turns
    // DEX into AC (up to tier + plus of it), heavy just soaks. Mitigation is the
    // min/max range rolled on every hit taken.
    armor: [
      { f: "__key", label: "key", type: "key" },
      { f: "cat", type: "select", opts: ["weapon", "armor", "ring", "trinket", "necklace"] },
      { f: "sub", label: "subtype", type: "select", opts: ["", "dagger", "sword", "axe", "spear", "bow", "light", "medium", "heavy"] },
      { f: "name", type: "text", cls: "name" },
      { f: "speed", type: "num", step: "0.1" }, { f: "toHit", label: "to-hit", type: "num" },
      { f: "range", type: "num" },
      { f: "defMin", label: "mit min", type: "num" }, { f: "defMax", label: "mit max", type: "num" },
      { f: "int", label: "INT (light)", type: "num" }, { f: "mp", label: "MP (light)", type: "num" },
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
      { f: "toHit", label: "to-hit", type: "num" }, { f: "ac", label: "AC", type: "num" },
      // Which hand-laid floor this boss is fought on. Boss floors are not rolled
      // like ordinary ones — see the "Boss arenas" note in the formula reference.
      { f: "arena", type: "select", opts: ["", "hall", "ring"] },
    ],
    boons: [
      { f: "__key", label: "key", type: "key" },
      { f: "name", type: "text", cls: "name" },
      { f: "icon", type: "text" }, { f: "color", type: "color" },
      { f: "desc", label: "description", type: "text", cls: "name" },
    ],
  };
  // Blank templates when adding a row.
  const TEMPLATES = {
    monsters: { name: "New Monster", hp: 5, atkMin: 1, atkMax: 2, glyph: "?", color: "#c0c0c0" },
    gear: { cat: "weapon", name: "New Gear", dmgMin: 1, dmgMax: 3, speed: 1, toHit: 0, tier: 1, req: { STR: 0 }, glyph: "/", color: "#cccccc" },
    consumables: { cat: "potion", name: "New Item", effect: "heal", glyph: "!", color: "#cccccc" },
    bosses: { name: "New Boss", hp: 40, atkMin: 4, atkMax: 6 },
    boons: { name: "New Boon", desc: "", icon: "✦", color: "#f0c14b" },
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
  const flippedSkill = new Set();   // skill nodes currently showing raw code, keyed "cls:id"
  // The effect kinds the engine understands, and the numbers each one reads.
  // Leaving a param blank makes the engine fall back to its built-in default.
  const EFFECT_TYPES = ["", "burn", "poison", "shock", "thorns", "haste", "walkHaste", "defense"];
  const EFFECT_PARAMS = {
    burn:    [["burstMult", "burst × power", "0.05"], ["dotTurns", "burn turns", "1"]],
    poison:  [["initial", "initial hit", "1"], ["perTurn", "dmg / turn", "1"], ["turns", "turns per dose", "1"]],
    shock:   [["burstMult", "burst × power", "0.05"], ["stunPer", "stun / power", "0.01"]],
    thorns:  [["mult", "reflect × power", "0.05"]],
    haste:   [["mult", "attack haste (0–1)", "0.05"]],
    walkHaste: [["mult", "walk haste (0–1)", "0.05"]],
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
  // A skill tree is a flat list of nodes, each with a stable `id` and grid-ish
  // `x`/`y` layout coordinates; prerequisites name ids, so a node can require
  // parents from anywhere in the tree.
  //   node = { id, x, y, name, icon, kind, when, desc, levels, ranks,
  //            req: ["id", …], reqAny: [["id", minRank], …] }
  // This mirrors normalizeTree() in game.js on purpose. The editor rewrites
  // data.js wholesale, so it has to understand exactly what the engine reads —
  // and it has to accept the old 5×5 grid (cells addressed by [tier, slot]) too,
  // or opening a stale localStorage draft would quietly drop every authored tree.
  function skillSlug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
  function normalizeSkillTree(raw) {
    if (!Array.isArray(raw)) return [];
    const nodes = [], byPos = {};
    if (raw.some((row) => Array.isArray(row))) {   // old shape: rows of cells, blanks are null
      raw.forEach((tier, y) => (Array.isArray(tier) ? tier : []).forEach((cell, x) => {
        if (!cell || !cell.name) return;
        const n = Object.assign({}, cell);
        n.id = cell.id || cell.key || skillSlug(cell.name);
        n.x = x; n.y = y;                          // the grid WAS the layout — keep it as-is
        byPos[y + "," + x] = n.id;
        nodes.push(n);
      }));
    } else {
      raw.forEach((cell, i) => {
        if (!cell || !(cell.id || cell.key || cell.name)) return;
        const n = Object.assign({}, cell);
        n.id = cell.id || cell.key || skillSlug(cell.name);
        n.x = typeof n.x === "number" ? n.x : i % SLOTS;
        n.y = typeof n.y === "number" ? n.y : (i / SLOTS) | 0;
        nodes.push(n);
      });
    }
    // Canonicalize prerequisites to [["id", minRank], …] — the same shape for req
    // and reqAny both, matching game.js. An entry may arrive as an old
    // [tier, slot(, minRank)] coordinate (numbers), a bare "id", or ["id"] with the
    // rank left implicit (meaning 1); a rank of "max" means that skill's top rank.
    const toRef = (r) => {
      if (typeof r === "string") return [r, 1];
      if (!Array.isArray(r) || !r.length) return null;
      if (typeof r[0] === "number") return [byPos[r[0] + "," + r[1]] || "", r[2] || 1];
      return [String(r[0] || ""), r[1] || 1];
    };
    for (const n of nodes) {
      if (n.key === n.id) delete n.key;            // `key` is only an alias for `id`
      n.desc = n.desc || "";
      n.levels = Array.isArray(n.levels) ? n.levels.slice(0, 4) : [];
      n.req = (n.req || []).map(toRef).filter(Boolean);
      n.reqAny = (n.reqAny || []).map(toRef).filter(Boolean);
      if (!n.reqAny.length) delete n.reqAny;
      if (!(n.minLevel > 0)) delete n.minLevel;
      // An innate skill is known from level 0 and costs no point — the class simply
      // has it (ToneTum's Magic Missile). Kept as a real boolean so a round-trip
      // through the editor cannot quietly turn it into a skill you must buy.
      if (n.innate) n.innate = true; else delete n.innate;
    }
    return nodes;
  }
  function skillNodeAt(o, x, y) { return o.skillTree.find((n) => n.x === x && n.y === y) || null; }
  // Normalize a class: stats/start/levelUp exist, and the skill tree is a flat
  // node list whatever shape it arrived in.
  function ensureClass(obj) {
    obj.stats = Object.assign({ STR: 5, INT: 5, VIT: 5, DEX: 5, RES: 5, LCK: 5 }, obj.stats || {});
    obj.start = obj.start || {};
    obj.levelUp = obj.levelUp || {};
    obj.skillTree = normalizeSkillTree(obj.skillTree);
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
    if (activeTab === "gear") main.appendChild(renderGearTables());
    else if (activeTab === "monsters") main.appendChild(renderMonsterTables());
    else if (TABLE_COLLS.includes(activeTab)) main.appendChild(renderTable(activeTab));
    else if (activeTab === "biomes") main.appendChild(renderBiomes());
    else if (activeTab === "classes") main.appendChild(renderClasses());
    else if (activeTab === "enchants") main.appendChild(renderEnchants());
    else if (activeTab === "reference") main.appendChild(renderReference());
    else main.appendChild(renderJson(activeTab));
    setStatus("");
  }

  // Value shown in a column for a row (handles the key column + reqSTR mapping).
  function cellValue(row, col) {
    if (col.f === "__key") return row.key || "";
    return getField(row.obj, col.f);   // "" when missing
  }
  // Does a row match the filter text? (any column contains the string)
  function rowMatches(coll, row, q, spec) {
    for (const col of (spec || SPECS[coll])) {
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

  // opts (all optional): stateKey (separate sort/filter state, for split tables
  // that share one coll), filterFn (row => bool, narrows which rows this table
  // shows/counts), heading (label shown instead of coll), addBase/addLabel
  // (key prefix + button text for "+ Add"), template (row seed), hint (false to
  // suppress the tip paragraph, for split tables that share one hint above them).
  function renderTable(coll, opts) {
    opts = opts || {};
    const stateKey = opts.stateKey || coll;
    const wrap = document.createElement("div");
    const spec = opts.spec || SPECS[coll];

    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); bar.appendChild(h);
    const filt = document.createElement("input");
    filt.type = "text"; filt.className = "filter"; filt.placeholder = "filter…"; filt.value = filterText[stateKey] || "";
    bar.appendChild(filt);
    wrap.appendChild(bar);

    if (opts.hint !== false) {
      const note = document.createElement("p"); note.className = "hint";
      note.textContent = "Click a column header to sort by it (again to reverse); type in the filter box to narrow the list. " + tableHint(typeof opts.hint === "string" ? opts.hint : coll);
      wrap.appendChild(note);
    }

    const tw = document.createElement("div"); tw.className = "tablewrap";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    for (const col of spec) {
      const th = document.createElement("th"); th.className = "sortable"; th.dataset.f = col.f;
      th.onclick = () => {
        const s = sortState[stateKey];
        if (s && s.f === col.f) s.dir = (s.dir === "asc" ? "desc" : "asc");
        else sortState[stateKey] = { f: col.f, dir: "asc" };
        rebuild();
      };
      htr.appendChild(th);
    }
    htr.appendChild(document.createElement("th"));   // delete column (not sortable)
    thead.appendChild(htr); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    tw.appendChild(table); wrap.appendChild(tw);

    if (!opts.noAdd) {
      const add = document.createElement("div"); add.className = "addrow";
      const addBase = opts.addBase || coll.replace(/s$/, "");
      const btn = document.createElement("button"); btn.textContent = "+ Add " + (opts.addLabel || addBase);
      btn.onclick = () => {
        filterText[stateKey] = "";   // clear the filter so the new row is visible
        rows[coll].push({ key: uniqueKey(coll, "new_" + addBase.replace(/[^a-z0-9]+/gi, "_")), obj: clone(opts.template || TEMPLATES[coll]) });
        render();
      };
      add.appendChild(btn); wrap.appendChild(add);
    }

    // Recompute the filtered/sorted view and repaint just the header labels +
    // body (so typing in the filter box keeps focus).
    function rebuild() {
      const base = opts.filterFn ? rows[coll].filter(opts.filterFn) : rows[coll];
      const q = (filterText[stateKey] || "").trim().toLowerCase();
      let view = q ? base.filter((row) => rowMatches(coll, row, q, spec)) : base.slice();
      const st = sortState[stateKey];
      if (st) { const col = spec.find((c) => c.f === st.f); if (col) view.sort((a, b) => cmpRows(a, b, col, st.dir)); }
      h.textContent = (opts.heading || coll) + " — " + (q ? view.length + " of " + base.length : base.length + " entries");
      const ths = thead.querySelectorAll("th");
      spec.forEach((col, idx) => {
        const on = st && st.f === col.f;
        ths[idx].textContent = (col.label || col.f) + (on ? (st.dir === "asc" ? " ▲" : " ▼") : "");
        ths[idx].classList.toggle("on", !!on);
      });
      tbody.innerHTML = "";
      view.forEach((row) => tbody.appendChild(renderRow(coll, row, spec)));
    }
    filt.oninput = () => { filterText[stateKey] = filt.value; rebuild(); };
    rebuild();
    return wrap;
  }

  // Gear gets its own tab layout: one table per equip category instead of one
  // giant mixed table, so weapons/armor/jewelry each get their relevant columns
  // to scan without wading through the rest.
  const GEAR_GROUPS = [
    { stateKey: "gear_weapon", heading: "weapons", addBase: "weapon", match: (cat) => cat === "weapon", template: Object.assign({}, TEMPLATES.gear, { cat: "weapon" }) },
    { stateKey: "gear_armor", heading: "armor", addBase: "armor", match: (cat) => cat === "armor", spec: SPECS.armor, template: Object.assign({}, TEMPLATES.gear, { cat: "armor", sub: "medium", dmgMin: undefined, dmgMax: undefined, toHit: undefined, defMin: 1, defMax: 3 }) },
    { stateKey: "gear_jewelry", heading: "rings & necklaces", addBase: "ring", addLabel: "ring/necklace", match: (cat) => cat === "ring" || cat === "necklace", template: Object.assign({}, TEMPLATES.gear, { cat: "ring", dmgMin: undefined, dmgMax: undefined }) },
    { stateKey: "gear_trinket", heading: "trinkets", addBase: "trinket", match: (cat) => cat === "trinket", template: Object.assign({}, TEMPLATES.gear, { cat: "trinket", dmgMin: undefined, dmgMax: undefined }) },
  ];
  function renderGearTables() {
    const wrap = document.createElement("div");
    const note = document.createElement("p"); note.className = "hint";
    note.textContent = tableHint("gear");
    wrap.appendChild(note);
    for (const g of GEAR_GROUPS) {
      wrap.appendChild(renderTable("gear", {
        stateKey: g.stateKey, heading: g.heading, addBase: g.addBase, addLabel: g.addLabel,
        template: g.template, spec: g.spec, hint: false,
        filterFn: (row) => g.match(getField(row.obj, "cat")),
      }));
    }
    return wrap;
  }

  // The monsters tab is two views of ONE row set: the stat block, then what the
  // creature does. Adding and deleting live on the first table only — a second
  // "+ Add monster" button under a second table of the same rows is a trap.
  function renderMonsterTables() {
    const wrap = document.createElement("div");
    wrap.appendChild(renderTable("monsters"));
    wrap.appendChild(renderTable("monsters", {
      stateKey: "monster_abilities", heading: "monster abilities", spec: SPECS.monsterAbilities,
      noAdd: true, hint: "abilities",
    }));
    return wrap;
  }

  function renderRow(coll, row, spec) {
    spec = spec || SPECS[coll];
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
  // Terrain painters (C2): b.terrain[kind] = { [countKey]: [min,max], size: [min,max] }.
  // Packed into one text field as "countMin,countMax,sizeMin,sizeMax" — blank disables
  // that terrain kind for this biome (deletes the key, so it round-trips clean).
  function terrainField(b, kind, countKey) {
    const wrap = document.createElement("label"); wrap.className = "bfield";
    const span = document.createElement("span"); span.textContent = "terrain: " + kind + " (" + countKey + " min,max, size min,max)"; wrap.appendChild(span);
    const inp = document.createElement("input"); inp.type = "text";
    const t = b.terrain && b.terrain[kind];
    const cnt = t && t[countKey], size = t && t.size;
    inp.value = t ? [cnt ? cnt[0] : "", cnt ? cnt[1] : "", size ? size[0] : "", size ? size[1] : ""].join(",") : "";
    inp.placeholder = "1,3,4,12";
    inp.oninput = () => {
      const v = inp.value.trim();
      if (v === "") { if (b.terrain) delete b.terrain[kind]; return; }
      const parts = v.split(",").map((s) => Number(s.trim()) || 0);
      b.terrain = b.terrain || {};
      const row = {};
      row[countKey] = [parts[0] || 1, parts[1] || parts[0] || 1];
      if (parts.length > 2) row.size = [parts[2] || 3, parts[3] || parts[2] || 3];
      b.terrain[kind] = row;
    };
    wrap.appendChild(inp);
    return wrap;
  }
  // How this biome's floors are SHAPED. Packed into one field the way terrain is,
  // in LAYOUT_KEYS order. Blank deletes the block and the biome uses the defaults
  // (3,8,56,55,70,6,265,0) — which are Shattered Pixel Dungeon's measured shape.
  const LAYOUT_KEYS = ["roomSideMin", "roomSideMax", "roomAreaMax", "attachPct", "attachCap", "hallLegMax", "roomTarget", "sarcophagusPct"];
  function layoutField(b) {
    const wrap = document.createElement("label"); wrap.className = "bfield";
    const span = document.createElement("span");
    span.textContent = "layout (side min,max · area max · attach % · attach cap % · hall leg max · room target · sarcophagus %)";
    wrap.appendChild(span);
    const inp = document.createElement("input"); inp.type = "text";
    const L = b.layout;
    inp.value = L ? LAYOUT_KEYS.map((k) => (L[k] != null ? L[k] : "")).join(",") : "";
    inp.placeholder = "3,8,56,55,70,6,265,0";
    inp.oninput = () => {
      const v = inp.value.trim();
      if (v === "") { delete b.layout; return; }
      const parts = v.split(",").map((t) => t.trim());
      const row = {};
      LAYOUT_KEYS.forEach((k, i) => { if (parts[i] !== undefined && parts[i] !== "") row[k] = Number(parts[i]) || 0; });
      b.layout = row;
    };
    wrap.appendChild(inp);
    return wrap;
  }
  function renderBiomes() {
    const wrap = document.createElement("div");
    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); h.textContent = "biomes — " + biomeRows.length + " in depth order"; bar.appendChild(h);
    wrap.appendChild(bar);
    const note = document.createElement("p"); note.className = "hint";
    note.textContent = "The biomes in depth order (each is 5 floors). Monsters = which creatures can spawn here (click to toggle; a monster also needs a minFloor on the Monsters tab to actually appear — that is the DEPTH it starts on, 1–25). Spawn mix is each monster's % chance to be the one that spawns, per floor — keep a floor's column ≤100% (over 100 turns red); floors shallower than a monster's minFloor are locked. spawnInitial = how many spawn on a fresh floor — one number, or per-floor like 3,5,5,5. exitStyle \"wall\" carves the exit into the border; blank = stairs. horror = which monster this biome sends after a player who overstays a floor (1000 turns); blank falls back to the biome's deepest-starting monster, and horror name is what it is called when it arrives.";
    wrap.appendChild(note);
    const bossKeys = rows.bosses.map((r) => r.key);
    const monKeys = rows.monsters.map((r) => r.key);
    const minFloorOf = {};   // a monster can only spawn at DEPTHS >= its minFloor (empty = disabled)
    for (const r of rows.monsters) { const mf = r.obj.minFloor; minFloorOf[r.key] = (mf === "" || mf == null) ? null : Number(mf); }
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
      grid.appendChild(biomeField(b, "exitSprite", "exitSprite", "text"));
      grid.appendChild(biomeField(b, "spawnEvery", "spawnEvery", "num"));
      grid.appendChild(biomeField(b, "spawnCap", "spawnCap", "num"));
      grid.appendChild(biomeField(b, "spawnInitial", "spawnInitial", "spawn"));
      // The Horror: which monster this biome's floor sends after a player who
      // overstays (1000 turns). Blank = the biome's deepest-starting monster.
      grid.appendChild(biomeField(b, "horror", "horror", "select", [""].concat(monKeys)));
      grid.appendChild(biomeField(b, "horror name", "horrorName", "text"));
      grid.appendChild(biomeField(b, "final biome?", "final", "bool"));
      grid.appendChild(layoutField(b));
      grid.appendChild(terrainField(b, "water", "pools"));
      grid.appendChild(terrainField(b, "grass", "patches"));
      grid.appendChild(terrainField(b, "rubble", "patches"));
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

      // spawn mix: a % chance per biome-floor (1–5) for each selected monster. A
      // floor the monster can't reach yet (below its minFloor) is locked; a floor
      // whose column totals over 100% is flagged red until it's brought back down.
      if (b.monsters.length) {
        const mix = document.createElement("div"); mix.className = "bmix";
        const ml2 = document.createElement("div"); ml2.className = "bmons-l"; ml2.textContent = "Spawn mix — % chance per floor (each floor should total ≤100%; over 100 turns red). “—” = the monster can't spawn on that floor yet (below its minFloor)."; mix.appendChild(ml2);
        const hdr = document.createElement("div"); hdr.className = "bmixrow head";
        const hn = document.createElement("span"); hn.className = "bmixname"; hdr.appendChild(hn);
        // Labels show the ABSOLUTE dungeon depth for this biome's slot (biome i covers
        // depths i*5+1 .. i*5+5) — minFloor/spawnMix values themselves stay biome-relative
        // (1-5), exactly as the engine reads them; this is a display-only fix so "Biome 2"
        // reads F6-F10 instead of F1-F5 like every other card.
        const depthBase = i * 5;
        for (let f = 1; f <= 5; f++) { const s = document.createElement("span"); s.className = "bmixw lbl"; s.textContent = "F" + (depthBase + f); hdr.appendChild(s); }
        mix.appendChild(hdr);
        b.spawnMix = b.spawnMix || {};
        const colInputs = [[], [], [], [], []];
        for (const k of b.monsters) {
          const row = document.createElement("div"); row.className = "bmixrow";
          const name = document.createElement("span"); name.className = "bmixname"; name.textContent = k; row.appendChild(name);
          const mf = minFloorOf[k];
          for (let f = 0; f < 5; f++) {
            // minFloor is an absolute DEPTH, so compare it against this column's
            // real floor number, not its 1–5 position inside the biome.
            const eligible = (mf != null && (depthBase + f + 1) >= mf);
            if (!eligible) {                                  // locked: can't spawn on this floor
              const sp = document.createElement("span"); sp.className = "bmixw locked"; sp.textContent = "—";
              sp.title = mf == null ? (k + " is disabled — set a minFloor on the Monsters tab") : (k + " can't spawn before depth " + mf);
              row.appendChild(sp); continue;
            }
            const inp = document.createElement("input"); inp.type = "number"; inp.className = "bmixw"; inp.min = "0"; inp.max = "100"; inp.placeholder = "0";
            const arr = b.spawnMix[k];
            inp.value = (arr && arr[f] != null) ? arr[f] : "";
            inp.oninput = () => {
              if (!Array.isArray(b.spawnMix[k])) b.spawnMix[k] = [];
              b.spawnMix[k][f] = inp.value === "" ? undefined : Number(inp.value);
              recolor();
            };
            colInputs[f].push(inp);
            row.appendChild(inp);
          }
          mix.appendChild(row);
        }
        // totals row: each floor's column sum, red when it exceeds 100%.
        const trow = document.createElement("div"); trow.className = "bmixrow total";
        const tn = document.createElement("span"); tn.className = "bmixname"; tn.textContent = "total"; trow.appendChild(tn);
        const totCells = [];
        for (let f = 0; f < 5; f++) { const s = document.createElement("span"); s.className = "bmixw tot"; totCells.push(s); trow.appendChild(s); }
        mix.appendChild(trow);
        function recolor() {
          for (let f = 0; f < 5; f++) {
            let sum = 0; for (const inp of colInputs[f]) sum += Number(inp.value) || 0;
            const over = sum > 100;
            for (const inp of colInputs[f]) inp.classList.toggle("over", over);
            totCells[f].textContent = colInputs[f].length ? sum + "%" : "";
            totCells[f].classList.toggle("over", over);
          }
        }
        recolor();
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
    wrap.appendChild(lg);
    const lnote = document.createElement("p"); lnote.className = "hint";
    lnote.textContent = "Added each level. Levels no longer grant crit — a crit is a flat 5% base for 125% damage, moved only by DEX, LCK and skills.";
    wrap.appendChild(lnote);

    const bh = document.createElement("h3"); bh.className = "csec"; bh.textContent = "Blurb"; wrap.appendChild(bh);
    const bg = document.createElement("div"); bg.className = "cform"; const bf = classField(o, "shown in class select", "blurb", "textarea"); bf.style.gridColumn = "1 / -1"; bg.appendChild(bf); wrap.appendChild(bg);

    // The skill tree, laid out on a grid by each node's x/y. Prerequisites point
    // at ids, not at grid positions, so the grid is only where nodes sit — the
    // graph itself can branch and rejoin however it likes.
    const th = document.createElement("h3"); th.className = "csec"; th.textContent = "Skill tree"; wrap.appendChild(th);
    const tnote = document.createElement("p"); tnote.className = "hint";
    tnote.textContent = "A 5×5 board: 5 tiers of 5 slots. A row is a TIER and a tier is gated on character level — tier 1 from the start, tier 2 at level 5, tier 3 at 10, tier 4 at 15, tier 5 at 20 — so which row you put a skill on is how much of the run it costs to reach. Blank squares stay blank in-game (they are drawn as empty sockets), so leaving gaps shapes the tree without lying about any node's tier. Each skill has a description, up to 4 level notes (the dots show how high it goes), prerequisites (other skills taken first, referred to by id — the game spells these out in words on the skill's card), and a wiring row: id (what prerequisites point at, and what the engine keys the skill by), icon, behavior (passive / rush / spin), when (a weapon subtype a passive needs, e.g. axe), req pts, and an optional extra min level that can only ask for MORE than the tier gate. A skill only works in-game once it has per-level mechanics — edit those (the ranks array) in the </> code view. Warrior's Rush, Spin and Sword Master are fully wired examples.";
    wrap.appendChild(tnote);
    const allSkills = [];   // gather named skills for the prereq picker
    for (const n of o.skillTree) if (n.name) allSkills.push({ id: n.id, name: n.name });
    // Show at least the usual 5×5, and grow if a node was placed beyond it — an
    // off-grid node must stay visible, or it would be invisibly uneditable.
    const rowsN = Math.max(TIERS, ...o.skillTree.map((n) => n.y + 1));
    const colsN = Math.max(SLOTS, ...o.skillTree.map((n) => n.x + 1));
    const tree = document.createElement("div"); tree.className = "stree";
    for (let y = 0; y < rowsN; y++) {
      const rowEl = document.createElement("div"); rowEl.className = "strow";
      const tl = document.createElement("div"); tl.className = "stier";
      const need = tierLevel(y);
      tl.textContent = "Tier " + (y + 1);
      tl.title = need ? "unlocked at character level " + need : "available from the start";
      const tlv = document.createElement("small"); tlv.textContent = need ? "Lv " + need : "start";
      tl.appendChild(tlv);
      rowEl.appendChild(tl);
      for (let x = 0; x < colsN; x++) rowEl.appendChild(renderSkillCell(o, x, y, allSkills));
      tree.appendChild(rowEl);
    }
    wrap.appendChild(tree);
    return wrap;
  }
  function renderSkillCell(o, x, y, allSkills) {
    const cell = skillNodeAt(o, x, y);
    const box = document.createElement("div"); box.className = "scell" + (cell ? " filled" : " blank");
    if (!cell) {
      const add = document.createElement("button"); add.className = "sadd"; add.textContent = "+";
      add.title = "add a skill here";
      add.onclick = () => {
        o.skillTree.push({ id: uniqueKeyArr(o.skillTree.map((n) => n.id), "new_skill"), x, y, name: "New Skill", desc: "", levels: ["", ""], req: [] });
        render();
      };
      box.appendChild(add);
      return box;
    }
    const at = o.skillTree.indexOf(cell);
    // header: name + flip-to-code + remove
    const fkey = activeClass + ":" + cell.id;
    const head = document.createElement("div"); head.className = "shead";
    const nm = document.createElement("input"); nm.className = "sname"; nm.type = "text"; nm.value = cell.name || ""; nm.placeholder = "name";
    nm.oninput = () => { cell.name = nm.value; };
    const flip = document.createElement("button"); flip.className = "bbtn flip"; flip.textContent = flippedSkill.has(fkey) ? "▦" : "</>"; flip.title = "flip between the form and raw JSON";
    flip.onclick = () => { if (flippedSkill.has(fkey)) flippedSkill.delete(fkey); else flippedSkill.add(fkey); render(); };
    const rm = document.createElement("button"); rm.className = "bbtn"; rm.textContent = "✕"; rm.title = "clear slot";
    rm.onclick = () => { flippedSkill.delete(fkey); o.skillTree.splice(at, 1); render(); };
    head.appendChild(nm); head.appendChild(flip); head.appendChild(rm); box.appendChild(head);
    if (flippedSkill.has(fkey)) {
      box.appendChild(codeEditor(cell, (parsed) => {
        if (parsed && typeof parsed === "object") { if (parsed.x == null) parsed.x = x; if (parsed.y == null) parsed.y = y; }
        o.skillTree[at] = parsed;   // by index: `cell` is replaced on the first keystroke
      }));
      return box;
    }
    // description
    const dsc = document.createElement("textarea"); dsc.className = "sdesc"; dsc.rows = 2; dsc.placeholder = "in-game description"; dsc.value = cell.desc || "";
    dsc.oninput = () => { cell.desc = dsc.value; };
    box.appendChild(dsc);
    // engine wiring: key + icon + behavior + condition. The per-level mechanics
    // (the `ranks` array) live in the </> code view — this row makes the skill real.
    const wire = document.createElement("div"); wire.className = "swire";
    const mkIn = (ph, f) => { const i = document.createElement("input"); i.type = "text"; i.placeholder = ph; i.value = cell[f] || ""; i.oninput = () => { if (!i.value) delete cell[f]; else cell[f] = i.value.trim(); }; return i; };
    const idIn = document.createElement("input"); idIn.type = "text"; idIn.placeholder = "id"; idIn.value = cell.id || "";
    idIn.title = "stable id — what other skills' prerequisites point at, and what the engine keys the skill by";
    idIn.oninput = () => {
      const from = cell.id, to = idIn.value.trim() || skillSlug(cell.name);   // never blank: an empty id orphans every prerequisite
      if (to === from) return;
      cell.id = to;
      // Prerequisites name ids, so renaming one would silently unhook every node
      // that requires this skill — carry the references along with the rename.
      for (const n of o.skillTree) {
        if (n === cell) continue;
        n.req = (n.req || []).map((r) => (Array.isArray(r) && r[0] === from ? [to, r[1]] : r));
        if (n.reqAny) n.reqAny = n.reqAny.map((r) => (Array.isArray(r) && r[0] === from ? [to, r[1]] : r));
      }
    };
    wire.appendChild(idIn);
    wire.appendChild(mkIn("icon", "icon"));
    const kind = document.createElement("select");
    // Must list every kind game.js dispatches for a TREE skill; a kind missing here
    // gets silently rewritten to "passive" the moment anyone touches the control.
    const KINDS = ["passive", "rush", "spin", "smite", "throwmon"];
    if (cell.kind && KINDS.indexOf(cell.kind) < 0) KINDS.push(cell.kind);   // never lose a hand-authored one
    for (const k of KINDS) { const op = document.createElement("option"); op.value = k; op.textContent = k; kind.appendChild(op); }
    kind.value = cell.kind || "passive";
    kind.onchange = () => { cell.kind = kind.value; };
    wire.appendChild(kind);
    wire.appendChild(mkIn("when (e.g. axe)", "when"));
    const rp = document.createElement("input"); rp.type = "number"; rp.min = "0"; rp.placeholder = "req pts";
    rp.title = "gate on TOTAL points spent in this tree — for deep nodes that shouldn't depend on one particular branch";
    rp.value = cell.reqPoints || "";
    rp.oninput = () => { const v = parseInt(rp.value, 10); if (v > 0) cell.reqPoints = v; else delete cell.reqPoints; };
    wire.appendChild(rp);
    const inn = document.createElement("label"); inn.className = "sinnate";
    const innCb = document.createElement("input"); innCb.type = "checkbox"; innCb.checked = !!cell.innate;
    innCb.title = "known from level 0 and costs no skill point — the class simply has it";
    innCb.onchange = () => { if (innCb.checked) cell.innate = true; else delete cell.innate; };
    inn.appendChild(innCb); inn.appendChild(document.createTextNode("innate"));
    wire.appendChild(inn);
    const ml = document.createElement("input"); ml.type = "number"; ml.min = "0"; ml.placeholder = "extra min lv";
    ml.title = "an EXTRA character-level gate on top of this row's tier gate (tier " + (y + 1) + " already needs level " + (tierLevel(y) || 1) + "). It can only ask for more, never less — leave it blank unless one skill in the row should come later than its neighbours.";
    ml.value = cell.minLevel || "";
    ml.oninput = () => { const v = parseInt(ml.value, 10); if (v > 0) cell.minLevel = v; else delete cell.minLevel; };
    wire.appendChild(ml);
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
    const others = allSkills.filter((k) => k.id !== cell.id);
    if (others.length) {
      const pr = document.createElement("div"); pr.className = "sprereq";
      const l = document.createElement("div"); l.className = "bmons-l"; l.textContent = "Requires:"; pr.appendChild(l);
      const chips = document.createElement("div"); chips.className = "chips";
      cell.req = cell.req || [];
      // Each prerequisite carries how many ranks it demands. Clicking the chip turns
      // it on at rank 1; clicking again cycles 2, 3, 4, "max", then off — so "Spin,
      // maxed" is authorable here rather than only by hand-editing data.js.
      const RANKS = [1, 2, 3, 4, "max"];
      const at = (id) => cell.req.findIndex((r) => Array.isArray(r) && r[0] === id);
      for (const k of others) {
        const chip = document.createElement("button"); chip.className = "chip";
        const paint = () => {
          const i = at(k.id), rank = i >= 0 ? cell.req[i][1] : 0;
          chip.className = "chip" + (i >= 0 ? " on" : "");
          chip.textContent = k.name + (i < 0 || rank === 1 ? "" : rank === "max" ? " · max" : " · " + rank);
        };
        chip.title = "click to require this skill; click again to raise the rank it must reach";
        chip.onclick = () => {
          const i = at(k.id);
          if (i < 0) cell.req.push([k.id, 1]);
          else {
            const next = RANKS[RANKS.indexOf(cell.req[i][1]) + 1];
            if (next === undefined) cell.req.splice(i, 1); else cell.req[i][1] = next;
          }
          paint();
        };
        paint();
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
    note.textContent = "On-hit procs rolled onto gear (blue+). proc = chance (0–1) it fires per hit. The tier scaling table is a free-form reference — the engine doesn't read it, use it however you like when picking the Effect block's numbers. Slots = which item types it can roll on. The Effect block drives what it DOES (a type + numbers the engine reads directly), and the description is shown to the player. Hit “</> code” to edit the whole enchant as raw JSON.";
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
      // Tier scaling: a 5-row table (not a single dropdown) so every level's value
      // is visible and editable at once. Pre-filled with the "+1 base stat" curve
      // used elsewhere in the game (the ring/necklace triangular formula: 1, 3, 6,
      // 10, 15) as a sane starting point — the engine doesn't read this itself,
      // it's here for you to reference while picking the Effect block's numbers.
      if (!Array.isArray(o.tierValues) || o.tierValues.length !== 5) o.tierValues = [1, 3, 6, 10, 15];
      const tierWrap = document.createElement("div"); tierWrap.className = "bfield wide";
      const tierLabel = document.createElement("span"); tierLabel.textContent = "tier scaling (reference only — pick the Effect numbers to match)"; tierWrap.appendChild(tierLabel);
      const tierTable = document.createElement("table"); tierTable.className = "tier-table";
      const headRow = document.createElement("tr");
      for (const h of ["Tier", "Value"]) { const th = document.createElement("th"); th.textContent = h; headRow.appendChild(th); }
      tierTable.appendChild(headRow);
      for (let t = 0; t < 5; t++) {
        const row = document.createElement("tr");
        const tdT = document.createElement("td"); tdT.textContent = "Tier " + (t + 1); row.appendChild(tdT);
        const tdV = document.createElement("td");
        const vinp = document.createElement("input"); vinp.type = "number"; vinp.step = "0.5"; vinp.value = o.tierValues[t];
        vinp.oninput = () => { o.tierValues[t] = vinp.value === "" ? 0 : Number(vinp.value); };
        tdV.appendChild(vinp); row.appendChild(tdV);
        tierTable.appendChild(row);
      }
      tierWrap.appendChild(tierTable);
      card.appendChild(tierWrap);
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
    btn.onclick = () => { enchantRows.push({ key: uniqueKeyArr(enchantRows.map((r) => r.key), "new_enchant"), obj: { name: "New Enchant", icon: "✦", color: "#cccccc", proc: 0.3, tierValues: [1, 3, 6, 10, 15], slots: GEAR_CATS.slice(), desc: "", effect: { type: "burn", burstMult: 0.5, dotTurns: 3 } } }); render(); };
    add.appendChild(btn); wrap.appendChild(add);
    return wrap;
  }

  // ---- Reference: a read-only page of every formula the engine actually uses.
  // Nothing here is editable — it explains how the numbers on the other tabs
  // get combined into what happens in a run. Keep it in sync by hand when a
  // formula in game.js changes; there's no live link back to the code.
  const REFERENCE = [
    {
      title: "Core stats",
      rows: [
        { name: "Ability modifier", formula: "mod(stat) = floor((eff(stat) − 10) / 2)", note: "Every formula below that reads a stat (STR, INT, VIT, DEX, RES, LCK) means this — base roll plus whatever's added by worn gear. INT also adds the Guild's Scribe's Intellect bonus and STR the Blacksmith's Arm bonus (both: round-to-nearest-0.5 of Σ(item's +X × rarity quality mult) across worn gear — white ×1, green ×1.5, blue ×2, purple ×3, gold ×5) when those boons are held." },
        { name: "STR → damage", formula: "strBonus = mod(STR)", note: "Flat bonus added to every weapon hit. It no longer subtracts the weapon's STR requirement — stat requirements already hard-gate equipping, so the damage formula was charging for the same thing twice." },
        { name: "Stat requirements", formula: "every stat in an item's `req` (Gear tab) must be met by eff(stat) or it can't be equipped at all", note: "A hard gate, not a soft penalty — e.g. Chain Mail's req.STR 15 blocks equipping below 15 STR outright." },
        { name: "VIT → HP", formula: "+mod(VIT) max HP per CHARACTER LEVEL", note: "Applied per level the way 5e adds CON to every hit die — otherwise a +2 modifier would be worth 2 HP for the whole run." },
        { name: "DEX → to-hit/AC/crit", formula: "+mod(DEX) to-hit, +mod(DEX) AC (capped by armour subtype), +mod(DEX)% crit chance", note: "Light armour lets the whole modifier through, medium caps it at +2, heavy takes none." },
        { name: "INT → MP", formula: "+mod(INT) max MP per CHARACTER LEVEL", note: "Same shape as VIT → HP." },
        { name: "RES → damage taken", formula: "incoming damage cut by m / (m + 10), m = mod(RES)", note: "Applied before armor. +2 cuts 17%, +5 cuts 33%, +10 cuts 50%; total immunity stays unreachable however high RES climbs." },
        { name: "LCK → luck", formula: "+3% enchant proc, +2% crit chance, +5% crit damage per point of mod(LCK)", note: "" },
      ],
    },
    {
      title: "Health & mana",
      rows: [
        { name: "Max HP", formula: "maxHP = class.baseHp (13 default) + mod(VIT) × level + flat per-level HP gained", note: "Recomputed after any gear/level/stat change." },
        { name: "Max MP", formula: "maxMP = class.baseMp (0 default) + mod(INT) × level + flat per-level MP gained", note: "" },
        { name: "HP regen (per turn)", formula: "regenAcc += maxHP / (class.regenTurns − mod(VIT) × class.vitRegen × 5) × early-level multiplier; +1 HP each time it crosses 1", note: "Default regenTurns 600, vitRegen 2. The ×5 is what keeps a small modifier worth roughly what a raw stat used to be. The early-level multiplier is ×1.75 at character level 1, ×1.5 at 2, ×1.25 at 3 and ×1 from 4 on: the opening floors are where an unlucky fight is unrecoverable." },
        { name: "MP regen (per turn)", formula: "mpRegenAcc += maxMP / (class.mpRegenTurns − mod(INT) × class.intRegen × 5) × (1 + Deep Well); +1 MP each time it crosses 1", note: "Same shape as HP regen, driven by INT instead of VIT. ToneTum's Deep Well multiplies the whole thing by +10/25/50/100%." },
      ],
    },
    {
      title: "To hit & Armour Class",
      rows: [
        { name: "To hit", formula: "toHit = proficiency + mod(DEX) + weapon's to-hit + boon acc + passive skill acc", note: "Proficiency is 5e's: +2, rising by one every four levels (+2 at 1–4, +3 at 5–8, … +6 at 17+). There is no per-level accuracy any more — on a d20, +2 a level is +10 percentage points a level." },
        { name: "Armour Class", formula: "AC = 10 + min(mod(DEX), armour's tier + plus) + boon eva + passive skill eva — MEDIUM armour only", note: "Armour grants no flat AC. Only medium turns DEX into AC, and only up to tier + plus of it: a tier-1 jerkin caps you at +1 however nimble you are, and each upgrade scroll widens what your DEX is allowed to do. Spending past your own modifier is wasted. Light and heavy give no AC at all — they pay in INT/MP and in mitigation." },
        { name: "Hit roll", formula: "a hit is d20 + attacker's to-hit ≥ defender's AC", note: "A natural 1 always misses and a natural 20 always hits, so every fight stays 5–95%. One point of to-hit or AC is worth exactly 5 percentage points, which is the whole reason ability modifiers can be small: mod(DEX) spanning −1…+2 is a 15-point swing here, where on the old tanh curve it was worth 3." },
      ],
    },
    {
      title: "Critical hits",
      rows: [
        { name: "Crit chance", formula: "critChance = (5% base + Ourn's Perfectly Timed Blow (+1%/character level) + mod(DEX) + mod(LCK) × 2) / 100", note: "Levels give no crit of their own." },
        { name: "Crit damage", formula: "critMult = (125% base + mod(LCK) × 5) / 100", note: "The multiplier a critical hit's total damage is scaled by." },
      ],
    },
    {
      title: "Damage — you hitting a monster",
      rows: [
        { name: "Weapon roll", formula: "random(weapon's dmg min, weapon's dmg max)", note: "Unarmed: 2–3, boosted by Brynn's Unarmed Master while no weapon is equipped." },
        { name: "Total damage", formula: "total = weapon roll + strBonus + skill bonus (Smite/Rush/etc.) + flat passive bonus (Sword Master, etc.)", note: "" },
        { name: "Surprise attack", formula: "no damage bonus — guaranteed hit (no d20 roll) against a target that hasn't noticed you", note: "Purely a free hit, not extra damage — flags 'aware' true on the target either way." },
        { name: "Critical hit", formula: "total × critMult", note: "" },
      ],
    },
    {
      title: "Defense & mitigation — a monster hitting you",
      rows: [
        { name: "Raw hit", formula: "random(monster's atk min, monster's atk max) + bonus (e.g. a charge)", note: "" },
        { name: "RES reduction", formula: "raw × (1 − m / (m + 10)), m = mod(RES)", note: "Applied FIRST, as a % of the raw hit. +2 cuts 17%, +5 a third, +10 a half; immunity is unreachable." },
        { name: "Armour block", formula: "− random(armour's mit min, mit max) − Defense enchant bonus − Stone Skin roll", note: "Subtracted after RES. Subtypes no longer carry a flat bonus — mitigation is entirely the item's own range, which is where the three armour identities live. Final damage is floored at 1 no matter how much is mitigated." },
      ],
    },
    {
      title: "Weapon / armor upgrades (+X)",
      rows: [
        { name: "Weapon +X", formula: "dmg min += (tier − 1) × plus,  dmg max += tier × 2 × plus", note: "Higher-tier gear scales much harder per point of +X." },
        { name: "Armour +X", formula: "mit min += floor((plus + 1) / 2),  mit max = min(2 × base max, base max + plus)", note: "The OPPOSITE shape to a weapon's. A weapon's +X opens its top end; armour's raises the floor fast and the ceiling slowly, and the ceiling can at most double. Upgrading armour should make it dependable, not spiky — a +3 tier-1 robe is a reliable 2–4, not a wild 0–8." },
        { name: "Stat affix +X", formula: "each stat affix gives  item tier + triangular(plus),  where triangular(n) = n(n+1)/2", note: "TRIANGULAR, not flat: +1 adds 1, +2 adds 3, +3 adds 6, +4 adds 10. So a tier-1 affix reads +1 / +2 / +4 / +7 / +11 across +0…+4 — upgrade scrolls are worth far more to a stat affix than to the base item. This is also the one the item card got wrong for a long time: it printed a flat `plus` and so under-reported every item from +2 up." },
      ],
    },
    {
      title: "Enchants",
      rows: [
        { name: "Proc chance", formula: "proc = enchant's own % (Enchants tab) + max(0, mod(LCK)) × 3%", note: "Driven by the LUCK MODIFIER, not the raw stat, and never negative — at LCK 10 that is +0%, at LCK 16 it is +9%. (This row read \"eff(LCK) / 100\" until the D&D migration was chased through it; that claimed +10% at LCK 10, which was never what the code did.) Passive always-on effects (Defense, Speed) are typically authored at 100% proc." },
        { name: "Affixes per rarity", formula: "white: none · green: 1 stat · blue: 1 stat + 1 enchant · purple: 1 stat + 1 enchant, then 75% a 2nd stat else a 2nd enchant · gold: 2 stats + 2 enchants", note: "Both pools are drawn WITHOUT replacement, so an item never carries the same enchant or the same stat twice. That matters because a duplicate is not cosmetic: two of an enchant each roll their own proc, and two of a stat each add triangular(plus). Weapons have only three eligible enchants, so before this a gold or two-enchant purple weapon doubled up about a third of the time. If a category has fewer distinct enchants than the rarity asks for, the extra becomes a stat instead so the item still carries as many properties." },
        { name: "Which enchants an item can roll", formula: "every enchant whose `slots` list includes the item's cat (an enchant with no `slots` fits everything)", note: "Today that is 3 for weapons, 4 for armour, 5 for rings, 2 for trinkets, 5 for necklaces. Keep an eye on the small pools — a category with fewer eligible enchants than a gold roll wants will start substituting stats." },
        { name: "Tiered value lookup", formula: "tierValues[clamp(1, 5, item's gear tier) − 1]", note: "Any enchant with a `tierValues` array (5 numbers) on the Enchants tab reads its number from the TIER of the item carrying it — an untiered item counts as tier 1. Falls back to the effect's flat legacy field if `tierValues` is absent." },
        { name: "Poison", formula: "dose = round(weapon power × tiered %); stack += dose; each turn: hp −= stack, then stack −= 1", note: "Doses from repeated procs pile onto ONE running stack rather than layering separate timers — a big early stack keeps hurting as it winds down." },
        { name: "Defense (enchant)", formula: "armor def min += tiered amount,  armor def max += tiered amount", note: "" },
        { name: "Speed / haste", formula: "the matching speed multiplier includes (tiered value − 1) as an additive bonus", note: "Two separate kinds, and an enchant is one or the other: effect type `haste` quickens your ATTACKS, `walkHaste` quickens your WALK. A tiered value of 1.8 alone means ×1.8 on that axis only. Multiple sources stack additively; Ourn's boons are the one thing that counts toward both." },
        { name: "Burn", formula: "instant burst = power × burstMult (0.5 default); DOT = ceil(burst / 2) per turn for dotTurns (3 default)", note: "Refreshes to the newest proc rather than stacking — only one burn timer at a time." },
        { name: "Shock", formula: "instant burst = power × burstMult (1.0 default); stun chance = (burst × stunPer (0.1 default)) / monster level", note: "" },
        { name: "Thorns", formula: "reflect = round(incoming damage × mult (0.5 default))", note: "Fires back at whatever just hit you." },
      ],
    },
    {
      title: "Action speed & turn cost",
      rows: [
        { name: "Attack cost", formula: "1 / (weapon speed × (1 + attack haste) [+1 if a Metrognome is tuned to attack speed]) × every visible aura ×swing", note: "Attack haste = worn `haste` enchants + Ourn's boons. Lower cost = more actions per monster turn. An aura is the mirror image of haste: haste divides this, an aura multiplies it." },
        { name: "Walk cost", formula: "1 / (1 + walk haste [+1 if a Metrognome is tuned to walk speed]) × every visible aura ×step", note: "Walk haste = worn `walkHaste` enchants + Ourn's boons. Weapon speed is deliberately NOT in here: a heavy axe slows your swing, not your feet." },
        { name: "Every other action", formula: "1, flat", note: "A potion, a scroll, equipping, a skill, waiting. Neither haste shortens these, so consumables always cost real tempo." },
        { name: "Monster eligibility", formula: "spawns when its biome is active AND minFloor <= current depth", note: "minFloor is an absolute depth (the floor number in the HUD), not a 1–5 position within the biome. Blank disables the monster entirely." },
        { name: "Monster actions", formula: "banks your action's cost each turn, acts while it holds ≥ 1, and each action costs 1 / (walk speed) if it stepped or 1 / (attack speed) otherwise — capped at 2 actions", note: "walk/attack speed each fall back to the row's `speed` when blank, so setting only `speed` gives one figure for everything. 1.2 on an axis means a double-action every 5th turn on that axis; 0.8 means skipping one in 5. Halving your own cost halves what every monster banks — that IS haste." },
      ],
    },
    {
      title: "How many monsters a floor holds",
      rows: [
        { name: "At floor start", formula: "biome.spawnInitial (a number, or one per floor like 3,5,5,5); blank = min(9, 3 + depth / 2)", note: "Compare Shattered Pixel Dungeon, whose mobLimit() is 3 + depth%5 + Random.Int(3) — 4 to 9 across a chapter, averaging 6. Every monster starts ASLEEP." },
        { name: "Placement", formula: "a random room (never the one you start in), then a 25% chance of a SECOND monster in that same room", note: "Straight from SPD's createMobs, which rolls Random.Int(4) for a second mob after each placement. Scattering N monsters one-per-room gives N thin moments; letting a quarter double up gives fewer moments, but some of them are a pair — and a pair is a fight where a lone sleeper is a chore. It lands about 45% of occupied rooms holding two or more." },
        { name: "Respawn", formula: "every spawnEvery turns, if the floor holds fewer than spawnCap, one more arrives out of sight and at least 6 tiles away", note: "SPD's TIME_TO_RESPAWN is 50 turns, which is what every biome now uses. Before this only the forest had a respawn at all, so the other four cleared out and stayed cleared — with a 1000-turn floor clock, the back half of a visit was played on an empty map. Caps run 8 / 10 / 10 / 11 / 12 by biome." },
        { name: "Where a respawn may appear", formula: "a random floor tile that is not currently visible to you and at least 6 tiles away", note: "Never in sight — a monster blinking into existence in front of you reads as a bug, not a reinforcement." },
      ],
    },
    {
      title: "Auras, death bursts & hexes",
      rows: [
        { name: "Aura", formula: "every VISIBLE monster within its auraRange (Chebyshev) of you multiplies your walk cost by its aura ×step and your attack cost by its aura ×swing; several compound", note: "The visibility rule is the whole fairness of it — an unexplained tax on your movement arriving from a creature you cannot see is a bug report, not a mechanic. The affected tiles are tinted in the monster's aura colour, and the multiplier shows as a chip under the vitals bars. Red Slime is ×2 to step, Black Slime ×1.5 to swing, both at range 3." },
        { name: "Death burst", formula: "on death, everything within burst r takes randInt(1, burst dmg or the current DEPTH) — rolled separately per victim", note: "Then, as shares of the damage THAT victim took: a burn at burn %, a poison at poison %, and (player only) mana torn off at MP %. A stun of randInt(stun min, stun max) lands on top. Monsters are caught too, so a burst can chain through a pack — recursion is blocked, so a chain resolves once and does not loop." },
        { name: "Burn (on you)", formula: "deals its damage each turn, then cools by 1 to a floor of 1, and ends after as many turns as its opening tick", note: "Same shape as ToneTum's Burning Sensation. A 4-damage burn is 4+3+2+1 = 10 over four turns." },
        { name: "Poison (on you)", formula: "the whole stack lands each turn, then decays by 1", note: "Same shape as poison on a monster: a big stack keeps hurting as it winds down." },
        { name: "Hex chance", formula: "on a CONNECTING hit only, hex % to apply one of the monster's `hexes` at random", note: "Never on a miss — the song has to reach you." },
        { name: "hex", formula: "for `depth` turns, a blow of yours that already CONNECTED still misses, 50% of the time", note: "It sits after the to-hit roll, not as a penalty to it, so it defeats a guaranteed hit too — an ambush and a foe pinned in a doorway are certain against the FOE's dodging, and a hex is not the foe." },
        { name: "blind", formula: "for `depth` turns, sight radius is halved (8 → 4)", note: "Floored at 2. Lighting falls off over the shorter radius too, so the room genuinely closes in." },
        { name: "vertigo", formula: "for 3 turns, the direction you press is replaced by a random one of the eight", note: "Auto-travel is cancelled outright rather than staggered along, because a path you cannot walk straight is not a path." },
        { name: "charm", formula: "for `depth` turns or until anything damages you, you cannot attack the monster that cast it", note: "Melee and ranged both refuse, and refusing costs no turn. The singer's own next hit breaks it — which it may then re-apply on that same shot." },
        { name: "berserk", formula: "for 3–5 turns your input is discarded: you step greedily toward the nearest living monster and attack it", note: "Outranks charm — rage beats love, so a berserk player WILL go for the singer. The approach is greedy, not pathfound: rage is not clever, and walking into a wall still burns the turn." },
      ],
    },
    {
      title: "Floor shape (per biome)",
      rows: [
        { name: "Room size", formula: "w = randInt(sideMin + 1, sideMax), h = randInt(sideMin, sideMax − 1), rerolled while w × h > areaMax; 40% of rooms swap w and h", note: "Defaults 3 / 8 / 56, giving a mean room of ~30 tiles. That is Shattered Pixel Dungeon's shape read off its source: an SPD standard room is SizeCategory.NORMAL with outer dim 4–10, and Painter.fill insets 1, so its interior is 2×2 to 8×8 — about 25 tiles. The crypt overrides this at 6 / 13 / 120 for deliberately big chambers." },
        { name: "Room count", formula: "rooms are laid until their total floor reaches roomTarget (default 265), hard-capped at 22", note: "roomTarget ÷ average room size IS the room count — about 9–10 at the defaults, against SPD's ~10 on an equivalent floor. The number of ROOMS is what a floor feels like, because each one is an encounter: the same total floor divided into half as many rooms plays as half as much game." },
        { name: "Attached rooms", formula: "attachPct of rooms are placed flush against another with a single doorway between, up to attachCap % of all rooms", note: "Defaults 55% / 70% cap, which lands around 60% attached in practice — that shared-wall packing is how SPD's builder fits almost a whole floor together, and it is the difference between a warren and a scatter of chambers on the ends of hallways. 0 means every room is reached down a hall (what the crypt authors)." },
        { name: "Hall length", formula: "a corridor leg runs randInt(3, hallLegMax) tiles before it must bend", note: "The path still alternates axes after every leg — this only sets how far a straight run may go first. Default 6; the crypt runs 14." },
        { name: "Pillars", formula: "a room over 20 tiles gets 1 + (area − 21) / 5 obstacle pillars, capped at 12, each reverted if it would strand any room", note: "The cap exists because the uncapped formula turns a 12×10 crypt hall into twenty obstacles. The reachability check is CLAUDE.md rule 5 applied to the pass that used to entomb bosses." },
        { name: "Sarcophagi", formula: "sarcophagusPct of a room's pillars are DRAWN as stone coffins", note: "Not a new tile: a sarcophagus is a pillar, so it is already solid, sight-blocking and correct in every map predicate. This is only how it is painted (and what Examine calls it)." },
      ],
    },
    {
      title: "Monster AI & doors",
      rows: [
        { name: "Sight", formula: "sees you within 6 tiles AND has line of sight — the SAME 6 tiles you see", note: "Deliberately tied to the player's own sight rather than authored separately. The ambush (creep up on a sleeper, strike first, guaranteed hit) only works while neither side sees further than the other; a monster with the longer eyes opens every fight already awake, walking out of a dark you cannot see into. A closed door/bush blocks line of sight — it's only 'open' while something stands on it." },
        { name: "Hunting", formula: "in sight → moves straight toward you, refreshing its last-known-position trail every turn", note: "" },
        { name: "Tracking", formula: "out of sight but has a trail → walks to your last known position", note: "It doesn't forget the instant it loses sight — it commits to the spot it saw you last, right through a door or bush along the way." },
        { name: "Searching", formula: "reaches the last known spot, you're not there → 4 turns poking around a random nearby tile before giving up", note: "Mirrors Shattered Pixel Dungeon's Hunting → searching Wandering → idle Wandering chain." },
        { name: "Surprise window", formula: "only while fully idle (never hunting, tracking, or searching)", note: "'aware' stays true through the whole hunt/track/search chain — only a monster that's genuinely never noticed you grants a surprise hit." },
        { name: "Door reset", formula: "a door/bush a monster died on is propped open until you step on that tile again", note: "Stepping on it resets it to the normal close-behind-you cycle." },
      ],
    },
    {
      title: "Skill tree",
      rows: [
        { name: "Tier gate", formula: "a node on grid row y needs character level y × 5", note: "Tier 1 from the start, tier 2 at level 5, tier 3 at 10, tier 4 at 15, tier 5 at 20. Derived from where the node sits on the Classes tab's grid — there is nothing to author. A node's own `minLevel` can raise this but never lower it." },
        { name: "Prerequisites", formula: "req = every listed skill at its listed rank (AND); reqAny = at least one of them (OR)", note: "A rank of \"max\" means that skill's own top rank. Both are spelled out in words on the skill's card in-game, met or not." },
        { name: "Points gate", formula: "reqPoints = total ranks already bought anywhere in this class's tree", note: "For deep nodes that shouldn't depend on one particular branch." },
        { name: "Cost", formula: "1 unspent point per rank", note: "Points come only from Potions of Insight — 1 guaranteed per floor, 3 more on a boss kill." },
      ],
    },
    {
      title: "Armour: three identities",
      rows: [
        { name: "Light", formula: "+INT and +MP, thin mitigation, no AC", note: "A caster's robe. INT bonus equals its tier; MP runs 5/8/12/17/23 by tier plus one per point of plus. Grass armor, Cloth armor, Refined robe, Mages robe, Threads of fate." },
        { name: "Medium", formula: "AC = 10 + min(mod(DEX), tier + plus), mid mitigation", note: "The only armour where AC is a live stat, and the only place upgrade scrolls buy AC — each +1 opens one more point of your own DEX. Padded jerkin, Studded leather, Scale hauberk, Elven mail, Windwoven coat." },
        { name: "Heavy", formula: "no AC, no DEX, the largest mitigation ranges", note: "You get hit; it barely matters. Rusted mail, Chainmail, Banded plate, Knight\'s plate, Adamant bulwark." },
        { name: "Mitigation by tier", formula: "light 0–2 / 0–4 / 1–7 / 2–11 / 3–17 · medium 1–3 / 2–6 / 3–10 / 5–16 / 7–24 · heavy 2–5 / 4–9 / 6–15 / 9–23 / 13–34", note: "Exponential with widening gaps, so a tier jump is felt more than an upgrade scroll." },
      ],
    },
    {
      title: "Boss arenas",
      rows: [
        { name: "Layout", formula: "the boss's `arena`: \"ring\" or \"hall\" (blank = hall)", note: "Boss floors are hand-laid, not rolled like ordinary floors. \"ring\": 4–5 chambers on a circle joined rim to rim in a closed loop, boss in the chamber opposite the entrance, so the fight can be kited round rather than cornered. \"hall\": an antechamber and a short corridor into one great pillared room, boss at its centre." },
        { name: "Why hand-laid", formula: "connectivity is a property of the shape", note: "The ordinary generator drops obstacle trees in any room over 20 tiles, and a boss room was 70–170 — so it earned 15–30 pillars, and about 1 boss floor in 200 came out with the boss sealed in a 1-tile pocket. That is an unwinnable run, since the exit only opens when the boss dies. Boss floors no longer run the tree pass at all." },
        { name: "Hall pillars", formula: "single tiles on a 3-tile lattice, ~15% skipped", note: "Isolated pillars with two clear tiles either side; the floor stays one connected mesh whichever are dropped, so a colonnade can never wall the boss in." },
        { name: "No traps or thorn vaults", formula: "both skipped on a boss floor", note: "" },
      ],
    },
    {
      title: "The floor's patience (the Horror)",
      rows: [
        { name: "Grace period", formula: "1000 turns on a floor", note: "A warning lands at 900 turns. The turn count resets on every new floor, so this is per-floor, not per-run. The player watches it drain on the TIME bar in the bottom-left vitals stack, which turns red at the warning." },
        { name: "What arrives", formula: "the biome's `horror` monster, or its deepest-starting monster if unset", note: "Spawned out of sight, at least 8 tiles away, already hunting." },
        { name: "How it differs", formula: "×3 max HP, ×4 attack, and it never loses your trail", note: "Every other monster gives up after 10 turns with no line of sight; the Horror does not. Breaking sight buys distance, not escape." },
        { name: "XP awarded", formula: "0", note: "Deliberate: paying XP for a Horror would make farming them the best grind in the game, on the floor the player was meant to leave." },
        { name: "If you kill it", formula: "another comes 60 turns later", note: "Killing it buys a breather, not the floor back." },
      ],
    },
    {
      title: "Experience & leveling",
      rows: [
        { name: "XP to next level", formula: "threshold = current level × 6", note: "So reaching level L costs 3 × L × (L−1) XP in total: 6 to reach level 2, 270 for level 10, 1140 for level 20. Quadratic, the same shape Shattered Pixel Dungeon uses." },
        { name: "On level up", formula: "main stat +1 every 2 levels, secondary +1 every 3, plus the class's flat levelUp gains (hp/mp)", note: "Levels can chain in one XP grant if enough XP is banked at once. It was +2/+1 EVERY level, which drove a main stat to 53 by level 20 — a +21 modifier, nothing like the bounded thing (score − 10) / 2 assumes. Accuracy comes from the proficiency bonus now, not from levelUp." },
        { name: "Monster XP", formula: "ceil(monster's minFloor / 2)", note: "1 XP for a floor 1–2 monster, 2 for floor 3–4, 3 for floor 5+." },
        { name: "Boss XP", formula: "15 + round(boss's max HP × 0.4)", note: "" },
      ],
    },
    {
      title: "Identification",
      rows: [
        { name: "Uses needed", formula: "idNeed = round((tier + plus) × (random 1–10 + rarity rank) × 0.5)", note: "Rarity rank: white 1, green 2, blue 3, purple 4, gold 5. A USE is one swing of that weapon, or one hit taken while wearing that armor — not one turn. So a tier-1 white runs 1–6 uses, a tier-3 blue 6–20, a tier-5 gold +2 21–52. The ×0.5 is the dial; it was ×3, which put an ordinary blue at ~76 connecting blows and meant most gear was replaced before it was ever identified. A plain white item with no plus/stats/enchants starts already identified." },
        { name: "Progress", formula: "gains idXp on use/hits; identified once idXp ≥ idNeed", note: "" },
      ],
    },
    {
      title: "Loot rolls",
      rows: [
        { name: "Rarity", formula: "rolled from the Loot tab's rarity % weights", note: "Overridable by the Guild's Blessing boon." },
        { name: "+X on a drop", formula: "random(0, ceil(floor / 5))", note: "" },
        { name: "Affixes by rarity", formula: "white: nothing · green: 1 stat · blue: 1 stat + 1 enchant · purple: 1 stat + 1 enchant + (50/50) another stat or enchant · gold: 2 stats + 2 enchants", note: "Jewelry (ring/trinket/necklace) always gets at least one property even at white — a bare ring is worthless." },
        { name: "Category / tier / item", formula: "each rolled from the Loot tab's category and tier-by-floor weight tables, then an item within that (category, tier) by its own rarity % (or an even split of whatever's left)", note: "" },
      ],
    },
    {
      title: "Potions",
      rows: [
        { name: "Healing", formula: "total = round(maxHP × (90%–150%)); now = min(total, eff(VIT), missing HP); rest queues as heal-over-time (up to eff(VIT) more per turn)", note: "A big potion doesn't instantly top you off if it outpaces your VIT." },
        { name: "Strength / Vitality / Intelligence", formula: "flat +1 to the stat", note: "Vitality/Intelligence potions also grant the resulting max HP/MP increase immediately." },
        { name: "Stone Skin", formula: "40 turns of bonus block, rolled between level/2 and (level + floor + eff(VIT))/2 each hit", note: "" },
      ],
    },
    {
      title: "Gold",
      rows: [
        { name: "Gold pile", formula: "random(2, 12) + depth × 2", note: "" },
      ],
    },
    {
      title: "Merchant floor",
      rows: [
        { name: "When it appears", formula: "inserted right after every non-final boss kill, before the next biome's floor 1", note: "A peaceful, monster-free floor — doesn't consume a depth number." },
        { name: "Sell price", formula: "gearTier(item) × 2 gold", note: "Gear only, from your pack (not equipped slots). Flat — rarity/plus/enchants don't change it." },
        { name: "Potion price", formula: "20 gold flat", note: "3 stock slots, any potion except Insight; a slot restocks the instant it's bought." },
        { name: "Fountain full heal", formula: "(biome index + 1) × 20 gold", note: "20g after Forest, 40g after Caves, and so on." },
      ],
    },
  ];
  function renderReference() {
    const wrap = document.createElement("div");
    wrap.className = "refwrap";
    const bar = document.createElement("div"); bar.className = "collbar";
    const h = document.createElement("h2"); h.textContent = "reference";
    bar.appendChild(h); wrap.appendChild(bar);
    const note = document.createElement("p"); note.className = "hint";
    note.textContent = "Every formula the engine uses to turn the numbers on the other tabs into what happens in a run. Read-only — this page just explains how things combine; edit the actual values on Monsters, Gear, Classes, Loot, and Enchants.";
    wrap.appendChild(note);
    for (const sec of REFERENCE) {
      const secEl = document.createElement("div"); secEl.className = "csec"; secEl.textContent = sec.title;
      wrap.appendChild(secEl);
      const list = document.createElement("div"); list.className = "reflist";
      for (const row of sec.rows) {
        const r = document.createElement("div"); r.className = "refrow";
        const name = document.createElement("div"); name.className = "refname"; name.textContent = row.name;
        const formula = document.createElement("div"); formula.className = "refformula"; formula.textContent = row.formula;
        r.appendChild(name); r.appendChild(formula);
        if (row.note) { const noteEl = document.createElement("div"); noteEl.className = "refnote"; noteEl.textContent = row.note; r.appendChild(noteEl); }
        list.appendChild(r);
      }
      wrap.appendChild(list);
    }
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
    // tidy each biome's spawn mix: drop percentages for unselected monsters and any
    // row with nothing entered (all blank), and drop an empty mix.
    for (const b of out.biomes) {
      if (!b.spawnMix) continue;
      const mons = Array.isArray(b.monsters) ? b.monsters : [];
      for (const k of Object.keys(b.spawnMix)) {
        const a = b.spawnMix[k];
        const meaningful = mons.indexOf(k) >= 0 && Array.isArray(a) && a.some((w) => w != null);
        if (!meaningful) delete b.spawnMix[k];
        else b.spawnMix[k] = a.slice(0, 5).map((w) => (w == null ? null : Number(w)));
      }
      if (!Object.keys(b.spawnMix).length) delete b.spawnMix;
    }
    // drop a terrain block left empty (every kind cleared back to blank)
    for (const b of out.biomes) {
      if (b.terrain && !Object.keys(b.terrain).length) delete b.terrain;
    }

    out.classes = {};                                 // classes come from the form + skill grid
    const seenC = {};
    for (const { key, obj } of classRows) {
      if (!key) { problems.push("a class has an empty key"); continue; }
      if (seenC[key]) problems.push("classes: duplicate key “" + key + "”");
      seenC[key] = 1;
      const c = clone(obj);
      // Run the tree through the same normalizer the engine uses, so what lands in
      // data.js is always the shape game.js reads: ids and coordinates filled in,
      // prerequisites canonical. A node keeps ALL its other fields — so any
      // governing code written via the flip-to-JSON view survives untouched.
      c.skillTree = normalizeSkillTree(c.skillTree);
      const seenS = {};   // two nodes sharing an id would silently merge in-game
      for (const n of c.skillTree) {
        if (seenS[n.id]) problems.push("class “" + key + "”: duplicate skill id “" + n.id + "”");
        seenS[n.id] = 1;
      }
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
  const GH_DEFAULTS = { owner: "thebigbutsu", repo: "Cantori", branch: "main", path: "data.js" };
  function ghCfg() { try { return Object.assign({}, GH_DEFAULTS, JSON.parse(localStorage.getItem(GH_CFG) || "{}")); } catch (e) { return Object.assign({}, GH_DEFAULTS); } }
  function ghToken() { try { return localStorage.getItem(GH_TOK) || ""; } catch (e) { return ""; } }
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ""; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function base64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  // Name what actually moved on the branch, so the stop message is a diagnosis
  // rather than a wall. Top-level sections are enough to tell "someone retuned
  // monsters" from "someone rewrote the skill trees".
  function whatMoved(mine, theirs) {
    const keys = Array.from(new Set(Object.keys(mine || {}).concat(Object.keys(theirs || {}))));
    const moved = keys.filter((k) => JSON.stringify(mine[k]) !== JSON.stringify(theirs[k]));
    if (!moved.length) return "formatting only";
    return moved.slice(0, 6).join(", ") + (moved.length > 6 ? ", …" : "");
  }
  // data.js is a JS file wrapping one JSON literal — pull the literal back out.
  function parseDataFile(text) {
    try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); }
    catch (e) { return null; }
  }
  // What this page started from. Committing REPLACES data.js wholesale, so if the
  // file on the branch has moved on from this, the commit is a silent revert of
  // everything in between. Kept as a value (not a reference) and re-based after a
  // successful commit, so a second save in the same session doesn't false-alarm.
  let ghBaseline = JSON.stringify(SHIPPED);
  let ghOverwriteArmed = false;   // one deliberate confirmation, then it disarms again
  function ghMsg(m, k) { const e = $("ghMsg"); e.textContent = m; e.className = k || ""; }
  function reflectGhButton() { $("btnGh").classList.toggle("on", !!ghToken()); }
  // The repo's own default branch, so we can tell "you're saving to main" from
  // "you're saving to a feature branch that was merged and abandoned weeks ago".
  // That distinction is invisible in a text field, and a stale branch here is a
  // setting that quietly outlives the branch it names.
  let ghDefaultBranch = null;
  async function fetchDefaultBranch(c, token) {
    if (ghDefaultBranch || !token || !c.owner || !c.repo) return ghDefaultBranch;
    try {
      const res = await fetch("https://api.github.com/repos/" + c.owner + "/" + c.repo + "?_=" + Date.now(), {
        headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json" }, cache: "no-store",
      });
      if (res.ok) ghDefaultBranch = (await res.json()).default_branch || null;
    } catch (e) { /* offline or no permission — the target line just stays plain */ }
    return ghDefaultBranch;
  }
  function ghTargetLine(c) {
    const target = c.owner + "/" + c.repo + " → " + c.branch + " · " + c.path;
    if (ghDefaultBranch && c.branch !== ghDefaultBranch) {
      return "⚠ Saving to " + target + ". That is NOT this repo's default branch (" + ghDefaultBranch +
             "), so nothing you commit here reaches the live game until someone merges it.";
    }
    return "Saving to " + target + ".";
  }
  function refreshGhState() {
    const c = ghCfg();
    const conn = ghToken() ? "Connected." : "No token yet — paste one below to connect.";
    $("ghState").textContent = conn + " " + ghTargetLine(c);
  }
  function openGh() {
    const c = ghCfg();
    $("ghOwner").value = c.owner; $("ghRepo").value = c.repo; $("ghBranch").value = c.branch; $("ghPath").value = c.path;
    $("ghToken").value = ghToken();
    refreshGhState();
    ghMsg("", "");
    $("ghDlg").showModal();
    fetchDefaultBranch(c, $("ghToken").value.trim() || ghToken()).then(refreshGhState);
  }
  function ghSaveCfg() {
    const c = { owner: $("ghOwner").value.trim(), repo: $("ghRepo").value.trim(), branch: $("ghBranch").value.trim(), path: $("ghPath").value.trim() };
    try { localStorage.setItem(GH_CFG, JSON.stringify(c)); } catch (e) {}
    return c;
  }
  const ghBranchInput = () => $("ghBranch");
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
    // Fetch the file's current SHA *and content* WITHOUT the HTTP cache — a cached
    // GET returns a stale SHA and GitHub then rejects the PUT with a 409.
    async function currentFile() {
      const getRes = await fetch(api + "?ref=" + encodeURIComponent(c.branch) + "&_=" + Date.now(), { headers, cache: "no-store" });
      if (getRes.status === 404) return { sha: null, text: null };
      if (!getRes.ok) throw new Error("read " + getRes.status + " — " + (await getRes.text()).slice(0, 140));
      const j = await getRes.json();
      return { sha: j.sha, text: j.content ? base64ToUtf8(j.content) : null };
    }
    async function currentSha() { return (await currentFile()).sha; }
    async function put(sha) {
      const body = { message: "Edit " + c.path + " via Cantori editor", content: content, branch: c.branch };
      if (sha) body.sha = sha;
      return fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
    }
    try {
      // The safety check that stops a stale page eating live work.
      const live = await currentFile();
      const liveData = live.text == null ? null : parseDataFile(live.text);
      if (liveData && JSON.stringify(liveData) !== ghBaseline && !ghOverwriteArmed) {
        ghOverwriteArmed = true;
        // If the target isn't the default branch, THAT is almost always the story:
        // a one-off branch that was merged and left behind, still sitting in this
        // browser's settings. Say so first — "the file differs" is the symptom.
        await fetchDefaultBranch(c, token);
        if (ghDefaultBranch && c.branch !== ghDefaultBranch) {
          ghMsg("Stopped: you are saving to “" + c.branch + "”, which is NOT this repo's default branch (" +
                ghDefaultBranch + "). That branch has been left behind, so its data.js is far older than the one " +
                "this page loaded — committing would look like a mass revert, and would not reach the live game anyway. " +
                "Set Branch to “" + ghDefaultBranch + "” above and Commit again.", "err");
          // Pre-fill AND persist it, so the field, the stored config and the line
          // above all agree — a warning that contradicts the box it points at is
          // worse than no warning. Committing is still a deliberate second press.
          $("ghBranch").value = ghDefaultBranch;
          ghSaveCfg();
          refreshGhState();
          return;
        }
        ghMsg("Stopped: data.js on “" + c.branch + "” is NOT what this page loaded, so saving now would revert whatever changed since (" +
              "the branch differs in: " + whatMoved(JSON.parse(ghBaseline), liveData) + "). Hit “Load latest from branch” to start from what's actually there, " +
              "or press Commit again to overwrite them deliberately.", "err");
        // (a plain page reload often will NOT clear this — GitHub Pages can serve a
        // data.js behind the branch — which is what “Load latest from branch” is for)
        return;
      }
      let putRes = await put(live.sha);
      // 409 = the SHA moved under us (another commit, or a cached SHA). Re-read
      // the live SHA once and retry so a stale read doesn't block the save.
      if (putRes.status === 409) { ghMsg("Refreshing…", ""); putRes = await put(await currentSha()); }
      if (!putRes.ok) { throw new Error("commit " + putRes.status + " — " + (await putRes.text()).slice(0, 180)); }
      ghBaseline = JSON.stringify(data);   // the branch now holds exactly this
      ghOverwriteArmed = false;
      ghMsg("Committed! GitHub Pages redeploys in ~1 min.", "ok");
      setStatus("Committed " + c.path + " to " + c.owner + "/" + c.repo + " (" + c.branch + ").", "ok");
    } catch (e) {
      ghMsg("Failed: " + e.message, "err");
    }
  }

  // Pull data.js straight from the branch and start from it.
  //
  // "Reload the page" is NOT a reliable way to get current: editor.html is served
  // by GitHub Pages, whose CDN can hand you a data.js a deploy or two behind the
  // branch however hard you refresh. That is how you end up staring at an
  // out-of-date warning you cannot clear. Reading through the API bypasses Pages
  // entirely, so this always lands on what the branch actually holds.
  async function ghPull() {
    const c = ghSaveCfg();
    const token = $("ghToken").value.trim() || ghToken();
    if (!token) { ghMsg("Enter a token first.", "err"); return; }
    if (!c.owner || !c.repo || !c.branch || !c.path) { ghMsg("Fill in owner / repo / branch / path.", "err"); return; }
    if (!confirm("Load " + c.path + " from “" + c.branch + "”?\n\nAnything you have edited here and not committed is discarded.")) return;
    ghMsg("Fetching…", "");
    const api = "https://api.github.com/repos/" + c.owner + "/" + c.repo + "/contents/" + c.path;
    const headers = { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    try {
      const res = await fetch(api + "?ref=" + encodeURIComponent(c.branch) + "&_=" + Date.now(), { headers, cache: "no-store" });
      if (!res.ok) throw new Error("read " + res.status + " — " + (await res.text()).slice(0, 140));
      const parsed = parseDataFile(base64ToUtf8((await res.json()).content || ""));
      if (!parsed || !parsed.monsters) throw new Error("that file didn't parse as Cantori data");
      try { localStorage.removeItem(LSKEY); localStorage.removeItem(LSTIME); } catch (e) {}   // a stale draft would just win again
      source = parsed;
      ghBaseline = JSON.stringify(parsed);
      ghOverwriteArmed = false;
      dataSource = "branch"; draftAt = 0;
      reseed();
      renderSource();
      refreshDraftButtons();
      hideFresh();
      ghMsg("Loaded " + c.path + " from " + c.branch + " — you're on the live version now.", "ok");
      setStatus("Loaded " + c.path + " from " + c.branch + ".", "ok");
    } catch (e) {
      ghMsg("Failed: " + e.message, "err");
    }
  }

  // ---- "Which data am I actually looking at?" --------------------------------
  // Two entirely separate things can hand this page stale content, and neither is
  // fixed by reloading:
  //   1. a localStorage draft (written by Playtest) outranks the shipped data, and
  //      a hard reload does not touch localStorage — it is not the HTTP cache;
  //   2. the <script src="data.js?v=NN"> tag can be served from cache or from a
  //      GitHub Pages deploy that is behind the branch.
  // So the answer is stated permanently in the header, and anything suspicious
  // raises a banner with the button that actually fixes it.
  const ago = (ms) => {
    if (!ms) return "unknown age";
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    const hrs = Math.round(mins / 60);
    return hrs < 48 ? hrs + "h ago" : Math.round(hrs / 24) + " days ago";
  };
  function renderSource() {
    const el = $("srcTag"); if (!el) return;
    if (dataSource === "draft") {
      el.textContent = "⚙ local draft · " + ago(draftAt);
      el.className = "src draft";
      el.title = "This page is showing a Playtest draft saved in this browser, NOT data.js. Reloading will not clear it.";
    } else {
      el.textContent = dataSource === "branch" ? "live data.js (from branch)" : "live data.js";
      el.className = "src";
      el.title = "This page is showing the data.js it loaded.";
    }
  }
  function showFresh(html, actions) {
    const bar = $("freshBar"); if (!bar) return;
    $("freshMsg").innerHTML = html;
    const acts = $("freshActs"); acts.innerHTML = "";
    for (const [label, fn, cls] of (actions || [])) {
      const b = document.createElement("button");
      b.className = "tool " + (cls || ""); b.textContent = label; b.onclick = fn;
      acts.appendChild(b);
    }
    bar.classList.add("show");
  }
  function hideFresh() {
    const b = $("freshBar"); if (!b) return;
    b.classList.remove("show");
    $("freshMsg").innerHTML = ""; $("freshActs").innerHTML = "";
  }

  // Drop the draft and fall back to the data.js this page loaded.
  function useShipped() {
    try { localStorage.removeItem(LSKEY); localStorage.removeItem(LSTIME); } catch (e) {}
    source = clone(SHIPPED);
    dataSource = "shipped"; draftAt = 0;
    reseed(); renderSource(); refreshDraftButtons(); hideFresh();
    setStatus("Draft discarded — showing the data.js this page loaded.", "ok");
    verifyFresh();     // the draft was hiding it; make sure what's underneath is current
  }

  // Ask the server for data.js again, bypassing the HTTP cache, and compare it to
  // what the <script> tag actually gave us. Catches a cached or behind-the-branch
  // deploy, which a reload can easily fail to clear.
  async function verifyFresh() {
    let live;
    try {
      const res = await fetch("./data.js?fresh=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      live = parseDataFile(await res.text());
    } catch (e) { return; }
    if (!live || !live.monsters) return;
    if (JSON.stringify(live) === JSON.stringify(SHIPPED)) return;   // we are current
    showFresh(
      "The <b>data.js on the server is different</b> from the one this page loaded — this page is running on a cached copy. " +
      "Differs in: <b>" + whatMoved(SHIPPED, live) + "</b>.",
      [["Load the server's version", () => {
        try { localStorage.removeItem(LSKEY); localStorage.removeItem(LSTIME); } catch (e) {}
        source = live; dataSource = "shipped"; draftAt = 0;
        reseed(); renderSource(); refreshDraftButtons(); hideFresh();
        setStatus("Loaded the server's data.js.", "ok");
      }, "primary"]]
    );
  }

  // ---- Toolbar actions -------------------------------------------------------
  function setStatus(msg, kind) { const s = $("status"); s.textContent = msg; s.className = kind || ""; }
  function draftActive() { try { return !!localStorage.getItem(LSKEY); } catch (e) { return false; } }
  function refreshDraftButtons() { $("btnStop").style.display = draftActive() ? "" : "none"; }

  function doPlaytest() {
    const { data, problems } = buildData();
    if (problems.length) { setStatus("Fix: " + problems[0], "err"); return; }
    try { localStorage.setItem(LSKEY, JSON.stringify(data)); localStorage.setItem(LSTIME, String(Date.now())); }
    catch (e) { setStatus("Could not save draft: " + e.message, "err"); return; }
    refreshDraftButtons();
    setStatus("Draft saved — opening game…", "ok");
    window.open("./index.html", "_blank");
  }
  function doStop() {
    try { localStorage.removeItem(LSKEY); localStorage.removeItem(LSTIME); } catch (e) {}
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
  // Rebuild every tab's working state from `source`. Shared by Revert and by
  // "Load latest from branch" — both replace the whole document wholesale.
  function reseed() {
    for (const c of TABLE_COLLS) rows[c] = Object.entries(source[c] || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
    for (const c of JSON_COLLS) { let s = source[c] != null ? source[c] : {}; if (c === "loot") { s = Object.assign({}, s); delete s.enchants; } jsonText[c] = JSON.stringify(s, null, 2); jsonOk[c] = true; }
    enchantRows = Object.entries((source.loot && source.loot.enchants) || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
    biomeRows = clone(source.biomes || []);
    classRows = Object.entries(source.classes || {}).map(([k, v]) => ({ key: k, obj: clone(v) }));
    classRows.forEach((r) => ensureClass(r.obj)); activeClass = 0;
    render();
  }
  function doRevert() {
    if (!confirm("Discard all edits and reload the shipped content?")) return;
    source = clone(SHIPPED);
    reseed();
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
      monsters: "minFloor is the ON/OFF switch: leave it EMPTY to disable a monster, or set the DEPTH it starts appearing on (1–25, the floor number in the HUD — not a position within the biome). A monster must also be listed in a biome (Biomes tab) to show up there. speed (>1 acts more often, <1 less; blank = 1) is the base for BOTH axes; walk spd / atk spd override it one at a time, so a bear can lumber between tiles (walk 0.8) and still swing normally, or a hornet dart in AND sting fast. Blank to-hit / AC / range / charge / ranged use engine defaults (to-hit +3, AC 11). Auras, death bursts and hexes are on the second table below. Sprite = assets/tiles/<key>.png — a row with no PNG falls back to its glyph in its colour, which works but is not the finished article.",
      abilities: "What a creature DOES, over and above hitting you. All of it optional, all of it blank by default. AURA: auraRange is the Chebyshev radius, aura ×step multiplies what a player's move costs (Red Slime 2) and aura ×swing what an attack costs (Black Slime 1.5); several auras compound. An aura only bites while the creature is IN SIGHT — an unexplained tax arriving from an unlit room is a bug report, not a mechanic — and the tiles it covers are tinted with aura colour. BURST (on death): burst r is the radius, burst dmg the top of a 1..N roll (0 = use the current DEPTH), and burn/poison/MP % are shares of the damage that victim actually took; stun min/max is rolled on top. It catches monsters as well as the player, so a pack can chain. HEXES (on a connecting hit): hex % is the chance one lands, hexes is a comma-separated pick from hex, blind, vertigo, charm, berserk — hex makes half your CONNECTING blows slide off, blind halves sight, vertigo scrambles the direction you press, charm stops you attacking the singer until something hurts you, berserk hands your turns to the AI. hex and charm last the floor number, vertigo 3 turns, berserk 3–5.",
      gear: "cat sets the equip slot; subtype classifies it (weapons: dagger/sword/axe/spear/bow — armor: light/medium/heavy). WEAPONS use dmg min/max, speed, and to-hit (added to the d20 attack roll); ARMOR uses mit min/max (each hit blocks a random amount in that range) and, if LIGHT, its INT and MP columns; JEWELRY uses neither (value = rolled affixes). speed = attacks per turn: >1 attacks faster (cost 1/speed), <1 slower. range = reach: blank/1 is melee, 2+ lets you tap a monster that far away with line of sight to strike (spear 2, bow 5). Armour grants NO flat AC — the subtype IS the identity: light pays in INT/MP, MEDIUM is the only one that turns DEX into AC (up to tier + plus of it), heavy just soaks. tier drives affix size AND groups drops (it also scales any Speed/Poison/Defense enchant the item rolls). rarity % = this type's drop chance within its tier+category; blank = a 'default' that splits the remaining %. Tier-by-floor and category odds live in the Loot tab. Sprites: assets/tiles/<key>.png, else the glyph.",
      consumables: "effect is what it does: heal, strength, poison, map, teleport, burn. Droppable potions/scrolls appear as loot at equal odds; tick 'no drop' to keep one out of the pool (e.g. the torch).",
      bosses: "One boss guards floor 5 of each biome. Which biome uses which boss is set on the Biomes tab. `arena` picks the hand-laid floor it is fought on — \"ring\" is 4–5 chambers in a closed loop with the boss opposite the way in, \"hall\" is an antechamber leading to one great pillared room. Blank means hall.",
      boons: "After each boss, the player is offered 3 of these at random and picks 1 (lasts the run). name / icon / color / description are all editable here. The EFFECT of each boon is wired in code by its key — guild (on-hit proc +level%), kethara (grant a purple armor), maelon (heal on kill), ourn (grants the Ourn's Blink freeze skill). Renaming/retuning text is safe; a brand-new key will show and be pickable but has no effect until it's coded.",
    })[coll] || "";
  }
  function jsonHint(coll) {
    return ({
      biomes: "Ordered list of the 5 biomes. Each: key, name, floor/wall sprite names, monsters (keys), boss (a bosses key), optional bossCount, spawnInitial/spawnEvery/spawnCap, exitSprite, door (\"bush\"/\"door\"), horror + horrorName, final. The exit always sits embedded in a wall, on every biome — that's not configurable here. Terrain (water/grass/rubble) fields are \"countMin,countMax,sizeMin,sizeMax\" — blank disables that kind; water and rubble cost double to cross, grass hides monsters until you're beside them. layout is \"sideMin,sideMax,areaMax,attachPct,attachCap,hallLegMax,roomTarget,sarcophagusPct\" and shapes the floors themselves: room width is drawn from (sideMin+1 … sideMax) and height from (sideMin … sideMax−1) under the area cap; attachPct is the share of rooms placed flush against another with only a doorway between (0 = every room is down a hall) and attachCap the ceiling on those as a % of all rooms; hallLegMax is the longest straight run a corridor may take before it must bend; roomTarget is how much room floor to lay down before stopping, so roomTarget ÷ average room size IS the room count; sarcophagusPct is the share of a room's obstacle pillars painted as sarcophagi. Blank = the defaults 3,8,56,55,70,6,265,0, which match Shattered Pixel Dungeon's measured shape (~10 rooms averaging ~30 tiles). spawnEvery/spawnCap are the respawn drip: one monster every N turns while the floor holds fewer than the cap.",
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
  $("ghPull").onclick = ghPull;
  ghBranchInput().oninput = () => { ghSaveCfg(); ghOverwriteArmed = false; refreshGhState(); };
  $("ghSaveToken").onclick = ghSaveToken;
  $("ghForget").onclick = ghForget;

  render();
  refreshDraftButtons();
  renderSource();
  if (staleDraft) {
    showFresh(
      "You are editing a <b>Playtest draft saved in this browser " + ago(draftAt) + "</b>, not data.js — which is why a reload " +
      "(even a hard one) does not change what you see. It differs from the data.js this page loaded in: <b>" +
      whatMoved(source, SHIPPED) + "</b>.",
      [["Discard the draft, use data.js", useShipped, "primary"],
       ["Keep editing the draft", hideFresh, ""]]
    );
  } else {
    verifyFresh();      // no draft in the way — so check the copy we loaded is current
  }
  reflectGhButton();
  setStatus(draftActive() ? "Editing a saved draft (Playtest active)." : "Loaded shipped content.", "ok");
})();
