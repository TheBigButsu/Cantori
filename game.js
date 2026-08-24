/* ============================================================================
   Cantori — Milestone 2: "Teeth in the Dark"

     - Turn-based world: when you act, everything else gets a turn.
     - Classic dungeon vermin (rat, bat, snake, spider) that wake, hunt and bite.
     - Bump-to-attack combat with hit points on both sides.
     - Permadeath: at 0 HP the run ends; begin anew at Depth 1.

   Built on the Depth 1 dungeon (procedural levels, fog of war, stairs, camera,
   zoom, floor map).

   Controls:
     - Tap / click -> walk (auto-routes when safe; single steps once a monster
       is in sight). Walk into a monster to attack it.
     - Keyboard: arrows / WASD, plus 8-direction keys y u b n and the numpad.
   ========================================================================== */

(function () {
  "use strict";

  // ---- Map model -----------------------------------------------------------
  const MAP_W = 33;
  const MAP_H = 33;
  const FOV_RADIUS = 8;

  const WALL = 0;
  const FLOOR = 1;
  const STAIRS = 2;

  let map = [];
  let visible = [];
  let explored = [];
  let depth = 1;
  let dead = false;

  const player = {
    x: 0, y: 0, hp: 20, maxHp: 20, atkMin: 3, atkMax: 5,
    atkBonus: 0, weapon: null, armor: null, inv: [], gold: 0, xp: 0, level: 1,
  };
  function resetPlayer() {
    player.hp = 20; player.maxHp = 20; player.atkBonus = 0;
    player.weapon = null; player.armor = null; player.inv = []; player.gold = 0;
    player.xp = 0; player.level = 1;
    identified.clear();
  }
  let monsters = [];
  let items = [];
  let walkPath = [];

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const isWall = (x, y) => !inBounds(x, y) || map[y][x] === WALL;
  const passable = (x, y) => inBounds(x, y) && map[y][x] !== WALL;

  function blankGrid(fill) {
    const g = [];
    for (let y = 0; y < MAP_H; y++) g.push(new Array(MAP_W).fill(fill));
    return g;
  }

  // ---- Monsters: classic dungeon vermin -----------------------------------
  const VERMIN = {
    rat:    { glyph: "r", color: "#c9b48f", hp: 3, atkMin: 1, atkMax: 2, erratic: 0.0 },
    bat:    { glyph: "b", color: "#b491d6", hp: 2, atkMin: 1, atkMax: 2, erratic: 0.55 },
    snake:  { glyph: "s", color: "#7ec98a", hp: 4, atkMin: 2, atkMax: 3, erratic: 0.0 },
    spider: { glyph: "x", color: "#d68f8f", hp: 3, atkMin: 1, atkMax: 3, erratic: 0.2 },
  };
  const VERMIN_KEYS = Object.keys(VERMIN);
  const monsterAt = (x, y) => monsters.find((m) => m.hp > 0 && m.x === x && m.y === y) || null;
  const anyMonsterVisible = () =>
    monsters.some((m) => m.hp > 0 && inBounds(m.x, m.y) && visible[m.y][m.x]);

  // ---- Loot: weapons & armor ----------------------------------------------
  const GEAR = {
    dagger:  { cat: "weapon", name: "Dagger", atk: 1, glyph: "/", color: "#cfc3a0", weight: 5 },
    sword:   { cat: "weapon", name: "Sword",  atk: 3, glyph: "/", color: "#d8e0ec", weight: 2 },
    mace:    { cat: "weapon", name: "Mace",   atk: 5, glyph: "/", color: "#c8a878", weight: 1 },
    leather: { cat: "armor",  name: "Leather Armor", def: 1, glyph: "[", color: "#b98a5a", weight: 4 },
    chain:   { cat: "armor",  name: "Chain Mail",    def: 2, glyph: "[", color: "#b9c0c8", weight: 2 },
    plate:   { cat: "armor",  name: "Plate Armor",   def: 3, glyph: "[", color: "#dfe6f0", weight: 1 },
  };
  const GEAR_KEYS = Object.keys(GEAR);
  const itemAt = (x, y) => items.find((it) => it.x === x && it.y === y) || null;

  function weightedGearKey() {
    let total = 0;
    for (const k of GEAR_KEYS) total += GEAR[k].weight;
    let roll = Math.random() * total;
    for (const k of GEAR_KEYS) { roll -= GEAR[k].weight; if (roll <= 0) return k; }
    return GEAR_KEYS[0];
  }

  // ---- Loot: potions & scrolls (identified by use) ------------------------
  const CONSUM = {
    heal:     { cat: "potion", name: "Potion of Healing",  effect: "heal",     glyph: "!", color: "#e0685a", weight: 5 },
    strength: { cat: "potion", name: "Potion of Strength", effect: "strength", glyph: "!", color: "#f0a838", weight: 2 },
    poison:   { cat: "potion", name: "Potion of Poison",   effect: "poison",   glyph: "!", color: "#7ec98a", weight: 2 },
    mapping:  { cat: "scroll", name: "Scroll of Magic Mapping", effect: "map",      glyph: "?", color: "#cfe6b0", weight: 3 },
    teleport: { cat: "scroll", name: "Scroll of Teleport",      effect: "teleport", glyph: "?", color: "#b491d6", weight: 2 },
  };
  const CONSUM_KEYS = Object.keys(CONSUM);
  const identified = new Set();
  const defOf = (key) => GEAR[key] || CONSUM[key];
  function displayName(key) {
    const d = defOf(key);
    if (d.cat === "weapon" || d.cat === "armor" || identified.has(key)) return d.name;
    return d.cat === "potion" ? "Unidentified Potion" : "Unidentified Scroll";
  }
  function weightedConsumKey() {
    let total = 0;
    for (const k of CONSUM_KEYS) total += CONSUM[k].weight;
    let roll = Math.random() * total;
    for (const k of CONSUM_KEYS) { roll -= CONSUM[k].weight; if (roll <= 0) return k; }
    return CONSUM_KEYS[0];
  }

  // ---- Dungeon generation --------------------------------------------------
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const roomCenter = (r) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) });

  function overlaps(a, b, pad) {
    return (
      a.x - pad <= b.x + b.w && a.x + a.w + pad >= b.x &&
      a.y - pad <= b.y + b.h && a.y + a.h + pad >= b.y
    );
  }
  function carveRoom(r) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) map[y][x] = FLOOR;
  }
  function hTunnel(x1, x2, y) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) if (map[y][x] === WALL) map[y][x] = FLOOR;
  }
  function vTunnel(y1, y2, x) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) if (map[y][x] === WALL) map[y][x] = FLOOR;
  }

  function generateLevel() {
    map = blankGrid(WALL);
    explored = blankGrid(false);
    visible = blankGrid(false);
    walkPath = [];
    monsters = [];
    items = [];

    const rooms = [];
    for (let tries = 0; tries < 140 && rooms.length < 12; tries++) {
      const w = randInt(4, 8), h = randInt(4, 8);
      const x = randInt(1, MAP_W - w - 2), y = randInt(1, MAP_H - h - 2);
      const room = { x, y, w, h };
      if (rooms.some((r) => overlaps(r, room, 1))) continue;
      carveRoom(room);
      if (rooms.length > 0) {
        const a = roomCenter(rooms[rooms.length - 1]);
        const b = roomCenter(room);
        if (Math.random() < 0.5) { hTunnel(a.x, b.x, a.y); vTunnel(a.y, b.y, b.x); }
        else { vTunnel(a.y, b.y, a.x); hTunnel(a.x, b.x, b.y); }
      }
      rooms.push(room);
    }

    const start = roomCenter(rooms[0]);
    player.x = start.x;
    player.y = start.y;
    const last = roomCenter(rooms[rooms.length - 1]);
    map[last.y][last.x] = STAIRS;

    spawnMonsters(rooms);
    spawnItems(rooms);
    computeFOV();
  }

  function freeFloorSpot(rooms) {
    for (let t = 0; t < 60; t++) {
      const room = rooms[randInt(0, rooms.length - 1)];
      const x = randInt(room.x, room.x + room.w - 1);
      const y = randInt(room.y, room.y + room.h - 1);
      if (map[y][x] !== FLOOR) continue;
      if (x === player.x && y === player.y) continue;
      if (itemAt(x, y) || monsterAt(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  function spawnItems(rooms) {
    const count = randInt(2, 4);
    for (let i = 0; i < count; i++) {
      const spot = freeFloorSpot(rooms);
      if (!spot) continue;
      const r = Math.random();
      if (r < 0.34) {
        items.push({ x: spot.x, y: spot.y, key: "gold", amount: randInt(2, 12) + depth * 2 });
      } else if (r < 0.67) {
        items.push({ x: spot.x, y: spot.y, key: weightedGearKey() });
      } else {
        items.push({ x: spot.x, y: spot.y, key: weightedConsumKey() });
      }
    }
  }

  function spawnMonsters(rooms) {
    const count = Math.min(9, 3 + Math.floor(depth / 2));
    let guard = 0;
    while (monsters.length < count && guard++ < 300) {
      const ri = rooms.length > 1 ? randInt(1, rooms.length - 1) : 0;
      const room = rooms[ri];
      const x = randInt(room.x, room.x + room.w - 1);
      const y = randInt(room.y, room.y + room.h - 1);
      if (map[y][x] !== FLOOR) continue;
      if (x === player.x && y === player.y) continue;
      if (monsterAt(x, y)) continue;
      const type = VERMIN_KEYS[randInt(0, VERMIN_KEYS.length - 1)];
      const t = VERMIN[type];
      monsters.push({
        x, y, type, glyph: t.glyph, color: t.color,
        hp: t.hp, maxHp: t.hp, atkMin: t.atkMin, atkMax: t.atkMax, erratic: t.erratic,
      });
    }
  }

  // ---- Field of view (recursive shadowcasting) ----------------------------
  const OCT = [
    [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
    [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
  ];
  function castLight(cx, cy, row, start, end, xx, xy, yx, yy) {
    if (start < end) return;
    const r2 = FOV_RADIUS * FOV_RADIUS;
    let newStart = 0;
    for (let i = row; i <= FOV_RADIUS; i++) {
      let dx = -i - 1;
      const dy = -i;
      let blocked = false;
      while (dx <= 0) {
        dx++;
        const mx = cx + dx * xx + dy * xy;
        const my = cy + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (start < rSlope) continue;
        if (end > lSlope) break;
        if (dx * dx + dy * dy <= r2 && inBounds(mx, my)) {
          visible[my][mx] = true;
          explored[my][mx] = true;
        }
        if (blocked) {
          if (isWall(mx, my)) { newStart = rSlope; continue; }
          else { blocked = false; start = newStart; }
        } else if (isWall(mx, my) && i < FOV_RADIUS) {
          blocked = true;
          castLight(cx, cy, i + 1, start, lSlope, xx, xy, yx, yy);
          newStart = rSlope;
        }
      }
      if (blocked) break;
    }
  }
  function computeFOV() {
    for (let y = 0; y < MAP_H; y++) visible[y].fill(false);
    visible[player.y][player.x] = true;
    explored[player.y][player.x] = true;
    for (const o of OCT) castLight(player.x, player.y, 1, 1.0, 0.0, o[0], o[1], o[2], o[3]);
  }

  // ---- HUD / log -----------------------------------------------------------
  function log(msg, tone) {
    const el = document.getElementById("log");
    if (el) { el.textContent = msg; el.className = tone || ""; }
  }
  function updateHP() {
    const el = document.getElementById("hp");
    if (!el) return;
    el.textContent = "♥ " + Math.max(0, player.hp) + "/" + player.maxHp;
    const r = player.hp / player.maxHp;
    el.className = "hp" + (r <= 0.3 ? " low" : r <= 0.6 ? " mid" : "");
  }
  function updateHUD() {
    updateHP();
    const lv = document.getElementById("lv");
    if (lv) lv.textContent = "Lv " + player.level;
  }
  function setDepthLabel() {
    const el = document.getElementById("depthLabel");
    if (el) el.innerHTML = "Depth&nbsp;" + depth;
  }

  // ---- Combat --------------------------------------------------------------
  function attack(attacker, target) {
    if (attacker === player) {
      const watk = player.weapon ? GEAR[player.weapon].atk : 0;
      const dmg = randInt(player.atkMin, player.atkMax) + watk + player.atkBonus;
      target.hp -= dmg;
      if (target.hp <= 0) {
        monsters = monsters.filter((m) => m !== target);
        log("You strike the " + target.type + " — it dies. (-" + dmg + ")", "hit");
        gainXP(target);
      } else {
        log("You strike the " + target.type + ". (-" + dmg + ")", "hit");
      }
    } else {
      let dmg = randInt(attacker.atkMin, attacker.atkMax);
      const adef = player.armor ? GEAR[player.armor].def : 0;
      dmg = Math.max(1, dmg - adef);
      player.hp -= dmg;
      updateHUD();
      log("The " + attacker.type + " bites you. (-" + dmg + ")", "hurt");
      if (player.hp <= 0) die();
    }
  }

  function gainXP(m) {
    player.xp += m.maxHp;
    let threshold = player.level * 8;
    while (player.xp >= threshold) {
      player.xp -= threshold;
      player.level++;
      player.maxHp += 4;
      player.hp = Math.min(player.maxHp, player.hp + 4);
      player.atkBonus += 1;
      log("You grow stronger — Level " + player.level + "!", "hit");
      threshold = player.level * 8;
    }
    updateHUD();
  }

  // ---- Movement / a player action -----------------------------------------
  function canStep(x, y, dx, dy) {
    const nx = x + dx, ny = y + dy;
    if (!passable(nx, ny)) return false;
    if (dx !== 0 && dy !== 0 && isWall(x + dx, y) && isWall(x, y + dy)) return false;
    return true;
  }

  // Returns true if a turn was spent.
  function playerAct(dx, dy) {
    if (dead || (dx === 0 && dy === 0)) return false;
    const nx = player.x + dx, ny = player.y + dy;

    const mon = monsterAt(nx, ny);
    if (mon) { attack(player, mon); worldTurn(); return true; }

    if (canStep(player.x, player.y, dx, dy)) {
      player.x = nx; player.y = ny;
      computeFOV();
      pickUp();
      if (map[ny][nx] === STAIRS) { descend(); return true; }  // fresh level, no world turn
      worldTurn();
      return true;
    }
    return false;
  }

  function pickUp() {
    const it = itemAt(player.x, player.y);
    if (!it) return;
    if (it.key === "gold") {
      player.gold += it.amount;
      items = items.filter((x) => x !== it);
      log("You find " + it.amount + " gold.");
      return;
    }
    if (player.inv.length >= 12) { log("Your pack is full."); return; }
    player.inv.push({ key: it.key });
    items = items.filter((x) => x !== it);
    log("You pick up the " + displayName(it.key) + ".");
  }

  function descend() {
    depth++;
    setDepthLabel();
    generateLevel();
    log("You descend to depth " + depth + ".");
  }

  function die() {
    dead = true;
    walkPath = [];
    toggleInv(false);
    updateHUD();
    const sub = document.getElementById("goSub");
    if (sub) sub.textContent = "You reached Depth " + depth;
    const over = document.getElementById("gameover");
    if (over) over.hidden = false;
  }

  function restart() {
    dead = false;
    depth = 1;
    resetPlayer();
    setDepthLabel();
    updateHUD();
    const over = document.getElementById("gameover");
    if (over) over.hidden = true;
    generateLevel();
    log("A new adventurer enters the dungeon.");
  }

  // ---- Monster turns -------------------------------------------------------
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

  function stepMonsterToward(m) {
    let best = null, bestD = Infinity;
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!canStep(m.x, m.y, dx, dy)) continue;
      if (nx === player.x && ny === player.y) continue;
      if (monsterAt(nx, ny)) continue;
      const d = cheb(nx, ny, player.x, player.y);
      if (d < bestD) { bestD = d; best = [nx, ny]; }
    }
    if (best) { m.x = best[0]; m.y = best[1]; }
  }
  function stepMonsterRandom(m) {
    const opts = [];
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!canStep(m.x, m.y, dx, dy)) continue;
      if (nx === player.x && ny === player.y) continue;
      if (monsterAt(nx, ny)) continue;
      opts.push([nx, ny]);
    }
    if (opts.length) { const c = opts[randInt(0, opts.length - 1)]; m.x = c[0]; m.y = c[1]; }
  }

  function worldTurn() {
    for (const m of monsters.slice()) {
      if (m.hp <= 0) continue;
      if (cheb(m.x, m.y, player.x, player.y) === 1) {
        attack(m, player);
        if (dead) return;
        continue;
      }
      const sensed = visible[m.y][m.x] && cheb(m.x, m.y, player.x, player.y) <= FOV_RADIUS;
      if (sensed && Math.random() >= m.erratic) stepMonsterToward(m);
      else if (sensed) stepMonsterRandom(m);
      else if (Math.random() < 0.45) stepMonsterRandom(m);
    }
  }

  // ---- Pathfinding (BFS, 8-direction, across explored tiles) --------------
  const DIRS8 = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  function findPath(sx, sy, gx, gy) {
    if (!passable(gx, gy) || !explored[gy][gx] || (sx === gx && sy === gy)) return [];
    const key = (x, y) => y * MAP_W + x;
    const prev = new Map();
    prev.set(key(sx, sy), null);
    const queue = [[sx, sy]];
    let head = 0;
    while (head < queue.length) {
      const [cx, cy] = queue[head++];
      if (cx === gx && cy === gy) break;
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx, ny = cy + dy;
        if (!explored[ny] || !explored[ny][nx]) continue;
        if (!canStep(cx, cy, dx, dy)) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, [cx, cy]);
        queue.push([nx, ny]);
      }
    }
    if (!prev.has(key(gx, gy))) return [];
    const path = [];
    let cur = [gx, gy];
    while (cur) { path.push({ x: cur[0], y: cur[1] }); cur = prev.get(key(cur[0], cur[1])); }
    path.reverse();
    path.shift();
    return path;
  }

  function stepToward(tx, ty) {
    const dx = Math.sign(tx - player.x), dy = Math.sign(ty - player.y);
    if (dx === 0 && dy === 0) return;
    if (playerAct(dx, dy)) return;
    if (dx !== 0 && playerAct(dx, 0)) return;
    if (dy !== 0) playerAct(0, dy);
  }

  function walkTo(tx, ty) {
    if (!inBounds(tx, ty) || dead) return;
    if (anyMonsterVisible()) { stepToward(tx, ty); return; }  // stay in control near danger
    const path = findPath(player.x, player.y, tx, ty);
    if (path.length) walkPath = path;
  }

  // ---- Canvas, camera, zoom ------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mapCanvas = document.getElementById("map");
  const mctx = mapCanvas.getContext("2d");

  let stageW = 320, stageH = 480;
  let baseTile = 26, tile = 26;
  let viewCols = 13, viewRows = 21;
  let camX = 0, camY = 0;
  let dpr = 1;
  let zoom = 1;
  const MIN_ZOOM = 0.55, MAX_ZOOM = 2.8;
  let mapOpen = false;

  const reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const stage = document.getElementById("stage");
    stageW = stage.clientWidth;
    stageH = stage.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    baseTile = Math.min(38, Math.max(16, Math.floor(stageW / 13)));

    mapCanvas.style.width = stageW + "px";
    mapCanvas.style.height = stageH + "px";
    mapCanvas.width = Math.round(stageW * dpr);
    mapCanvas.height = Math.round(stageH * dpr);
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    applyLayout();
  }
  function applyLayout() {
    tile = Math.max(11, Math.min(64, Math.round(baseTile * zoom)));
    viewCols = Math.min(MAP_W, Math.max(5, Math.floor(stageW / tile)));
    viewRows = Math.min(MAP_H, Math.max(5, Math.floor(stageH / tile)));
    const cssW = viewCols * tile, cssH = viewRows * tile;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function setZoom(z) { zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)); applyLayout(); }
  function updateCamera() {
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    camX = clamp(player.x - Math.floor(viewCols / 2), MAP_W - viewCols);
    camY = clamp(player.y - Math.floor(viewRows / 2), MAP_H - viewRows);
  }

  // ---- Colours & lighting --------------------------------------------------
  const COL = { floorA: "#241c12", floorB: "#1d160d", wallFace: "#33291b", wallTop: "#48391f" };
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${Math.round(((n >> 16) & 255) * amount)},${Math.round(((n >> 8) & 255) * amount)},${Math.round((n & 255) * amount)})`;
  }
  let flick = 0;
  const MEM = 0.24;
  function litBright(mx, my) {
    const dx = mx - player.x, dy = my - player.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    return Math.max(0.42, Math.min(1, 1 - (d / (FOV_RADIUS + 1)) * 0.6 + flick));
  }
  let _font = null;
  function bodyFont() {
    if (!_font) _font = getComputedStyle(document.body).fontFamily || "monospace";
    return _font;
  }

  // ---- Draw: dungeon view --------------------------------------------------
  function draw() {
    updateCamera();
    ctx.fillStyle = "#0c0905";
    ctx.fillRect(0, 0, viewCols * tile, viewRows * tile);

    for (let sy = 0; sy < viewRows; sy++) {
      for (let sx = 0; sx < viewCols; sx++) {
        const mx = camX + sx, my = camY + sy;
        if (!inBounds(mx, my) || !explored[my][mx]) continue;
        const vis = visible[my][mx];
        const b = vis ? litBright(mx, my) : MEM;
        const px = sx * tile, py = sy * tile;
        const t = map[my][mx];
        if (t === WALL) {
          ctx.fillStyle = shade(COL.wallFace, b);
          ctx.fillRect(px, py, tile, tile);
          ctx.fillStyle = shade(COL.wallTop, b);
          ctx.fillRect(px, py, tile, Math.max(2, tile * 0.16));
        } else {
          const base = (mx + my) % 2 === 0 ? COL.floorA : COL.floorB;
          ctx.fillStyle = shade(base, b);
          ctx.fillRect(px + 1, py + 1, tile - 1, tile - 1);
          if (t === STAIRS) {
            ctx.fillStyle = shade("#f6b845", vis ? Math.max(b, 0.85) : MEM + 0.14);
            ctx.font = `700 ${Math.floor(tile * 0.82)}px ${bodyFont()}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(">", px + tile / 2, py + tile / 2 + tile * 0.04);
          }
        }
        if (!vis) { ctx.fillStyle = "rgba(70,90,130,0.10)"; ctx.fillRect(px, py, tile, tile); }
      }
    }

    // route markers
    for (const s of walkPath) {
      if (!inBounds(s.x, s.y) || !explored[s.y][s.x]) continue;
      const px = (s.x - camX) * tile, py = (s.y - camY) * tile;
      const sz = tile * 0.22;
      ctx.fillStyle = "rgba(246,184,69,0.16)";
      ctx.fillRect(px + (tile - sz) / 2, py + (tile - sz) / 2, sz, sz);
    }

    // floor items (only those the torch shows)
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const it of items) {
      if (!inBounds(it.x, it.y) || !visible[it.y][it.x]) continue;
      const px = (it.x - camX) * tile, py = (it.y - camY) * tile;
      let g;
      if (it.key === "gold") {
        g = { glyph: "$", color: "#f0c14b" };
      } else {
        const d = defOf(it.key);
        const known = d.cat === "weapon" || d.cat === "armor" || identified.has(it.key);
        g = { glyph: d.glyph, color: known ? d.color : (d.cat === "potion" ? "#b9a2d6" : "#c9c0a0") };
      }
      ctx.fillStyle = g.color;
      ctx.font = `700 ${Math.floor(tile * 0.72)}px ${bodyFont()}`;
      ctx.fillText(g.glyph, px + tile / 2, py + tile / 2 + tile * 0.04);
    }

    // monsters (only those the torch shows)
    for (const m of monsters) {
      if (m.hp <= 0 || !inBounds(m.x, m.y) || !visible[m.y][m.x]) continue;
      const px = (m.x - camX) * tile, py = (m.y - camY) * tile;
      ctx.fillStyle = m.color;
      ctx.font = `700 ${Math.floor(tile * 0.8)}px ${bodyFont()}`;
      ctx.fillText(m.glyph, px + tile / 2, py + tile / 2 + tile * 0.04);
      if (m.hp < m.maxHp) {
        const bw = tile * 0.66, bh = Math.max(2, tile * 0.09);
        const bx = px + (tile - bw) / 2, by = py + tile * 0.1;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "#d9584a";
        ctx.fillRect(bx, by, bw * (m.hp / m.maxHp), bh);
      }
    }

    // player
    const cx = (player.x - camX) * tile + tile / 2;
    const cy = (player.y - camY) * tile + tile / 2;
    const glow = ctx.createRadialGradient(cx, cy, tile * 0.1, cx, cy, tile * 2.6);
    glow.addColorStop(0, "rgba(246,184,69,0.26)");
    glow.addColorStop(1, "rgba(246,184,69,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - tile * 3, cy - tile * 3, tile * 6, tile * 6);
    ctx.font = `700 ${Math.floor(tile * 0.8)}px ${bodyFont()}`;
    ctx.fillStyle = "#f6b845";
    ctx.fillText("@", cx, cy + tile * 0.04);
    ctx.fillStyle = "#ffd98a";
    ctx.fillText("@", cx, cy + tile * 0.04 - Math.max(1, tile * 0.04));
  }

  // ---- Draw: floor map -----------------------------------------------------
  function drawMap() {
    const w = stageW, h = stageH;
    mctx.fillStyle = "rgba(8,6,3,0.97)";
    mctx.fillRect(0, 0, w, h);
    const pad = 22;
    const cell = Math.max(2, Math.floor(Math.min((w - pad * 2) / MAP_W, (h - pad * 2) / MAP_H)));
    const ox = Math.floor((w - cell * MAP_W) / 2), oy = Math.floor((h - cell * MAP_H) / 2);
    const gap = cell > 3 ? 1 : 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!explored[y][x]) continue;
        const t = map[y][x];
        mctx.fillStyle = t === WALL ? "#4b3d27" : "#221b12";
        mctx.fillRect(ox + x * cell, oy + y * cell, cell - gap, cell - gap);
        if (t === STAIRS) { mctx.fillStyle = "#f6b845"; mctx.fillRect(ox + x * cell, oy + y * cell, cell - gap, cell - gap); }
      }
    }
    const pc = Math.max(cell + 2, 5);
    mctx.fillStyle = "#ffd98a";
    mctx.fillRect(ox + player.x * cell - (pc - cell) / 2, oy + player.y * cell - (pc - cell) / 2, pc, pc);
    mctx.fillStyle = "#f6b845";
    mctx.font = `700 13px ${bodyFont()}`;
    mctx.textAlign = "left"; mctx.textBaseline = "top";
    mctx.fillText("FLOOR MAP · DEPTH " + depth, pad, pad - 8);
    mctx.fillStyle = "rgba(236,226,207,0.5)";
    mctx.font = `12px ${bodyFont()}`;
    mctx.textAlign = "center"; mctx.textBaseline = "bottom";
    mctx.fillText("tap to close", w / 2, h - pad + 10);
  }
  function toggleMap(force) {
    mapOpen = force === undefined ? !mapOpen : force;
    if (mapOpen) toggleInv(false);
    mapCanvas.hidden = !mapOpen;
    document.getElementById("btnMap").classList.toggle("on", mapOpen);
  }

  // ---- Pack / inventory ----------------------------------------------------
  let invOpen = false;
  function toggleInv(force) {
    invOpen = force === undefined ? !invOpen : force;
    if (invOpen) { toggleMap(false); renderInv(); }
    document.getElementById("inv").hidden = !invOpen;
    document.getElementById("btnBag").classList.toggle("on", invOpen);
  }
  function playerAtk() {
    const w = player.weapon ? GEAR[player.weapon].atk : 0;
    return (player.atkMin + player.atkBonus + w) + "–" + (player.atkMax + player.atkBonus + w);
  }
  function renderInv() {
    document.getElementById("invGold").textContent = player.gold + " gold";
    const df = player.armor ? GEAR[player.armor].def : 0;
    document.getElementById("invStats").textContent =
      "Level " + player.level + "  ·  Attack " + playerAtk() + "  ·  Defense " + df;
    document.getElementById("invEquip").textContent =
      "Wielding: " + (player.weapon ? GEAR[player.weapon].name : "—") +
      "   ·   Wearing: " + (player.armor ? GEAR[player.armor].name : "—");
    const ul = document.getElementById("invList");
    ul.innerHTML = "";
    if (player.inv.length === 0) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "(nothing carried)";
      ul.appendChild(li);
      return;
    }
    player.inv.forEach((it, idx) => {
      const def = defOf(it.key);
      const li = document.createElement("li");
      let tag;
      if (def.cat === "weapon") tag = "+" + def.atk + " atk";
      else if (def.cat === "armor") tag = "+" + def.def + " def";
      else tag = identified.has(it.key) ? "use" : "use · ?";
      li.innerHTML = '<span class="i-name">' + displayName(it.key) + "</span><span class=\"i-tag\">" + tag + "</span>";
      li.addEventListener("click", () => actItem(idx));
      ul.appendChild(li);
    });
  }
  function actItem(idx) {
    const it = player.inv[idx];
    if (!it) return;
    const def = defOf(it.key);
    if (def.cat === "weapon" || def.cat === "armor") equipItem(idx);
    else useConsumable(idx);
  }
  function equipItem(idx) {
    const it = player.inv[idx];
    if (!it) return;
    const def = GEAR[it.key];
    player.inv.splice(idx, 1);
    if (def.cat === "weapon") {
      if (player.weapon) player.inv.push({ key: player.weapon });
      player.weapon = it.key;
      log("You wield the " + def.name + ".");
    } else {
      if (player.armor) player.inv.push({ key: player.armor });
      player.armor = it.key;
      log("You don the " + def.name + ".");
    }
    updateHUD();
    worldTurn();               // equipping takes a turn
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  function useConsumable(idx) {
    const it = player.inv[idx];
    if (!it) return;
    const def = CONSUM[it.key];
    identified.add(it.key);      // using an item reveals what it is
    player.inv.splice(idx, 1);
    applyEffect(def.effect);
    updateHUD();
    if (dead) { toggleInv(false); return; }
    worldTurn();
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  function applyEffect(effect) {
    if (effect === "heal") {
      const amt = 8 + player.level * 2;
      player.hp = Math.min(player.maxHp, player.hp + amt);
      log("You drink a Potion of Healing. (+" + amt + ")", "hit");
    } else if (effect === "strength") {
      player.atkBonus += 1;
      log("Strength surges through your arms.", "hit");
    } else if (effect === "poison") {
      const amt = randInt(4, 8);
      player.hp -= amt;
      log("It was poison! (-" + amt + ")", "hurt");
      if (player.hp <= 0) die();
    } else if (effect === "map") {
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) explored[y][x] = true;
      log("The layout of this level floods into your mind.");
    } else if (effect === "teleport") {
      for (let t = 0; t < 400; t++) {
        const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
        if (passable(x, y) && !monsterAt(x, y)) { player.x = x; player.y = y; computeFOV(); break; }
      }
      log("Reality lurches — you stand somewhere new.");
    }
  }

  // ---- Main loop -----------------------------------------------------------
  const STEP_MS = 90;
  let lastT = 0, acc = 0;
  function frame(t) {
    if (!lastT) lastT = t;
    const dt = t - lastT;
    lastT = t;

    if (walkPath.length && !mapOpen && !invOpen && !dead) {
      acc += dt;
      while (acc >= STEP_MS && walkPath.length) {
        if (anyMonsterVisible()) { walkPath = []; break; }
        acc -= STEP_MS;
        const next = walkPath.shift();
        const moved = playerAct(next.x - player.x, next.y - player.y);
        if (!moved) { walkPath = []; break; }
      }
    } else {
      acc = 0;
    }

    if (!reduceMotion) flick = Math.sin(t / 420) * 0.14 + Math.sin(t / 130) * 0.05;
    if (mapOpen) drawMap();
    else draw();
    requestAnimationFrame(frame);
  }

  // ---- Keyboard ------------------------------------------------------------
  const BY_KEY = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    h: [-1, 0], j: [0, 1], k: [0, -1], l: [1, 0],
    y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
  };
  const BY_CODE = {
    Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
    Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
  };
  window.addEventListener("keydown", (e) => {
    if (dead) { if (e.key === "Enter" || e.key === " ") restart(); return; }
    const key = (e.key || "").toLowerCase();
    if (key === "i") { e.preventDefault(); toggleInv(); return; }
    if (invOpen) { if (e.key === "Escape") toggleInv(false); return; }
    if (key === "m") { e.preventDefault(); toggleMap(); return; }
    if (mapOpen) { if (e.key === "Escape") toggleMap(false); return; }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(zoom * 1.2); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom(zoom / 1.2); return; }
    const dir = BY_CODE[e.code] || BY_KEY[e.key] || BY_KEY[key];
    if (dir) { e.preventDefault(); walkPath = []; playerAct(dir[0], dir[1]); }
  });

  // ---- Buttons -------------------------------------------------------------
  document.getElementById("btnIn").addEventListener("click", () => setZoom(zoom * 1.2));
  document.getElementById("btnOut").addEventListener("click", () => setZoom(zoom / 1.2));
  document.getElementById("btnMap").addEventListener("click", () => toggleMap());
  document.getElementById("btnBag").addEventListener("click", () => toggleInv());
  mapCanvas.addEventListener("click", () => toggleMap(false));

  // tap outside the pack card closes it
  const invOverlay = document.getElementById("inv");
  invOverlay.addEventListener("click", (e) => { if (e.target === invOverlay) toggleInv(false); });
  document.getElementById("invClose").addEventListener("click", () => toggleInv(false));

  const over = document.getElementById("gameover");
  over.addEventListener("click", restart);
  over.addEventListener("touchstart", (e) => { e.preventDefault(); restart(); }, { passive: false });

  // ---- Mouse wheel zoom ----------------------------------------------------
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  // ---- Touch: tap-to-walk, two-finger pinch-to-zoom -----------------------
  let touchMode = null, tapStart = null, pinchStartDist = 0, pinchStartZoom = 1, lastTouchEnd = 0;
  const dist2 = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  function tileAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = Math.floor((clientX - rect.left) / (rect.width / viewCols));
    const sy = Math.floor((clientY - rect.top) / (rect.height / viewRows));
    return [camX + sx, camY + sy];
  }
  canvas.addEventListener("touchstart", (e) => {
    if (mapOpen || invOpen || dead) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      touchMode = "pinch";
      pinchStartDist = dist2(e.touches[0], e.touches[1]) || 1;
      pinchStartZoom = zoom;
    } else if (e.touches.length === 1) {
      touchMode = "tap";
      const t = e.touches[0];
      tapStart = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    if (touchMode === "pinch" && e.touches.length >= 2) {
      e.preventDefault();
      const d = dist2(e.touches[0], e.touches[1]) || 1;
      setZoom(pinchStartZoom * (d / pinchStartDist));
    } else if (touchMode === "tap" && e.touches.length === 1) {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > 16) touchMode = "drag";
    }
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    if (touchMode === "tap" && tapStart) {
      e.preventDefault();
      lastTouchEnd = performance.now();
      const [tx, ty] = tileAt(tapStart.x, tapStart.y);
      walkTo(tx, ty);
    }
    if (e.touches.length === 0) { touchMode = null; tapStart = null; }
  }, { passive: false });
  canvas.addEventListener("click", (e) => {
    if (performance.now() - lastTouchEnd < 500) return;
    const [tx, ty] = tileAt(e.clientX, e.clientY);
    walkTo(tx, ty);
  });

  // ---- Dev hook ------------------------------------------------------------
  window.cantori = {
    descend, regenerate: generateLevel, setZoom, toggleMap, toggleInv, restart,
    hurt: (n) => { player.hp -= n; updateHUD(); if (player.hp <= 0) die(); },
    give: (k) => { if (defOf(k)) player.inv.push({ key: k }); },
    peek: () => {
      let ex = 0;
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (explored[y][x]) ex++;
      return {
        depth, hp: player.hp, maxHp: player.maxHp, level: player.level, xp: player.xp,
        atkBonus: player.atkBonus, gold: player.gold, weapon: player.weapon, armor: player.armor,
        inv: player.inv.map((i) => i.key), identified: [...identified],
        x: player.x, y: player.y, dead, explored: ex,
        monsters: monsters.length,
        mlist: monsters.map((m) => ({ x: m.x, y: m.y, type: m.type, hp: m.hp })),
        items: items.map((it) => ({ x: it.x, y: it.y, key: it.key })),
      };
    },
    useIdx: (i) => actItem(i),
    step: (dx, dy) => playerAct(dx, dy),
    place: (x, y) => { if (passable(x, y)) { player.x = x; player.y = y; computeFOV(); } },
  };

  // ---- Go ------------------------------------------------------------------
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();
  generateLevel();
  updateHUD();
  requestAnimationFrame(frame);
})();
