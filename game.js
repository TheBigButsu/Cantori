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
  const MAP_W = 41;         // ~50% larger floor than before (33 -> 41)
  const MAP_H = 41;
  const FOV_RADIUS = 40;    // effectively line-of-sight bound: the whole room you're
                            // in lights up (Shattered-Pixel style); only walls block

  const WALL = 0;
  const FLOOR = 1;
  const STAIRS = 2;

  let map = [];
  let visible = [];
  let explored = [];
  let depth = 1;
  let dead = false;

  // ---- Biomes: 5 floors each, boss on the 5th ------------------------------
  let biomeIndex = 0;
  let biome = null;
  let bossActive = false;      // a boss is present and the exit is sealed
  let bossName = "";
  const biomeOf = (d) => Math.min(DATA.biomes.length - 1, Math.floor((d - 1) / 5));
  const floorInBiome = (d) => ((d - 1) % 5) + 1;
  const isBossDepth = (d) => floorInBiome(d) === 5;

  // Stats → effects (skill tree to spend points comes later)
  const UNARMED_MIN = 2, UNARMED_MAX = 3;
  const HP_BASE = 6, HP_PER_VIT = 2;
  const strBonus = () => Math.floor(player.stats.STR / 4);   // STR → damage
  const computeMaxHp = () => HP_BASE + player.stats.VIT * HP_PER_VIT; // VIT → health
  const playerEvasion = () => Math.min(0.35, player.stats.DEX * 0.015); // DEX → dodge
  const vitResist = () => Math.floor(player.stats.VIT / 5);  // VIT → damage resist

  const player = {
    x: 0, y: 0, hp: 20, maxHp: 20, atkMin: UNARMED_MIN, atkMax: UNARMED_MAX,
    atkBonus: 0, weapon: null, armor: null, inv: [], gold: 0, xp: 0, level: 1,
    cls: "warrior", stats: { STR: 5, INT: 5, VIT: 5, DEX: 5, RES: 5, LCK: 5 },
    statPoints: 0, evasion: 0,
  };
  function applyClass(key) {
    const c = DATA.classes[key] || DATA.classes.warrior;
    player.cls = key;
    player.stats = Object.assign({ STR: 5, INT: 5, VIT: 5, DEX: 5, RES: 5, LCK: 5 }, c.stats || {});
    player.statPoints = 0; player.atkBonus = 0;
    player.atkMin = UNARMED_MIN; player.atkMax = UNARMED_MAX;
    player.weapon = null; player.armor = null; player.inv = []; player.gold = 0;
    player.xp = 0; player.level = 1;
    identified.clear();
    player.maxHp = computeMaxHp();
    player.hp = player.maxHp;
    player.evasion = playerEvasion();
    if (c.start) {                             // starting kit, already equipped
      if (c.start.weapon && GEAR[c.start.weapon]) player.weapon = c.start.weapon;
      if (c.start.armor && GEAR[c.start.armor]) player.armor = c.start.armor;
    }
  }
  function resetPlayer() { applyClass(player.cls || "warrior"); }
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

  // ---- Content data (edit game content in data.js) ------------------------
  const DATA = window.CANTORI_DATA;
  const VERMIN = DATA.monsters;
  const VERMIN_KEYS = Object.keys(VERMIN);
  const monsterAt = (x, y) => monsters.find((m) => m.hp > 0 && m.x === x && m.y === y) || null;
  const anyMonsterVisible = () =>
    monsters.some((m) => m.hp > 0 && inBounds(m.x, m.y) && visible[m.y][m.x]);

  // ---- Loot: weapons & armor (defined in data.js) -------------------------
  const GEAR = DATA.gear;
  const GEAR_KEYS = Object.keys(GEAR);
  const itemAt = (x, y) => items.find((it) => it.x === x && it.y === y) || null;

  function weightedGearKey() {
    let total = 0;
    for (const k of GEAR_KEYS) total += GEAR[k].weight;
    let roll = Math.random() * total;
    for (const k of GEAR_KEYS) { roll -= GEAR[k].weight; if (roll <= 0) return k; }
    return GEAR_KEYS[0];
  }

  // ---- Loot: potions & scrolls, identified by use (defined in data.js) ----
  const CONSUM = DATA.consumables;
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
    turns = 0;

    const rooms = [];
    // smaller rooms, more of them: same-ish total room area spread over a bigger
    // map, so there's much more corridor between chambers
    for (let tries = 0; tries < 240 && rooms.length < 18; tries++) {
      const w = randInt(3, 5), h = randInt(3, 5);
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

    biomeIndex = biomeOf(depth);
    biome = DATA.biomes[biomeIndex];

    const start = roomCenter(rooms[0]);
    player.x = start.x;
    player.y = start.y;
    const last = rooms[rooms.length - 1];

    if (isBossDepth(depth)) {
      // The 5th floor: a boss guards the last room; the exit opens on its defeat.
      bossActive = true;
      spawnBoss(last);
    } else {
      bossActive = false;
      placeExit(last);
      spawnMonsters(rooms);
    }
    spawnItems(rooms);
    computeFOV();
    setDepthLabel();
    floaters = [];
    snapPlayer();
  }

  // ---- Monster & boss factories -------------------------------------------
  function makeMonster(type, x, y) {
    // copy the whole template so ability flags (evasion/charge/ranged/range) carry over
    return Object.assign({}, VERMIN[type], {
      x, y, type, boss: false, hp: VERMIN[type].hp, maxHp: VERMIN[type].hp, level: depth,
    });
  }
  function makeBoss(key, x, y) {
    const b = DATA.bosses[key];
    return {
      x, y, type: key, boss: true, name: b.name, glyph: "@", color: "#f0a838", level: depth,
      hp: b.hp, maxHp: b.hp, atkMin: b.atkMin, atkMax: b.atkMax, erratic: 0.0,
    };
  }
  function monName(m) {
    return m.boss ? m.name : (VERMIN[m.type] ? VERMIN[m.type].name : m.type);
  }
  function spawnBoss(room) {
    const key = biome.boss;
    bossName = DATA.bosses[key].name;
    const n = biome.bossCount || 1;
    const cx = Math.floor(room.x + room.w / 2), cy = Math.floor(room.y + room.h / 2);
    const spots = [[cx, cy], [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1], [cx - 1, cy - 1], [cx + 1, cy + 1]];
    let placed = 0;
    for (const [x, y] of spots) {
      if (placed >= n) break;
      if (map[y] && map[y][x] === FLOOR && !monsterAt(x, y) && !(x === player.x && y === player.y)) {
        monsters.push(makeBoss(key, x, y));
        placed++;
      }
    }
    if (placed === 0) monsters.push(makeBoss(key, cx, cy));
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
    const pool = eligiblePool();
    if (!pool.length) return;
    const si = biome.spawnInitial;
    let count;
    if (Array.isArray(si)) { const i = floorInBiome(depth) - 1; count = si[i] != null ? si[i] : si[si.length - 1]; }
    else if (si != null) count = si;
    else count = Math.min(9, 3 + Math.floor(depth / 2));
    let guard = 0;
    while (monsters.length < count && guard++ < 300) {
      const ri = rooms.length > 1 ? randInt(1, rooms.length - 1) : 0;
      const room = rooms[ri];
      const x = randInt(room.x, room.x + room.w - 1);
      const y = randInt(room.y, room.y + room.h - 1);
      if (map[y][x] !== FLOOR) continue;
      if (x === player.x && y === player.y) continue;
      if (monsterAt(x, y)) continue;
      monsters.push(makeMonster(pool[randInt(0, pool.length - 1)], x, y));
    }
  }

  // Place the level exit. "wall" style carves a gap in the border trees at the
  // edge of the last clearing (a path onward); otherwise it's stairs in a room.
  function placeExit(room) {
    const cx = Math.floor(room.x + room.w / 2), cy = Math.floor(room.y + room.h / 2);
    if (biome.exitStyle === "wall") {
      const edges = [
        [cx, room.y - 1], [cx, room.y + room.h],
        [room.x - 1, cy], [room.x + room.w, cy],
      ];
      for (const [x, y] of edges) {
        if (inBounds(x, y) && map[y][x] === WALL) { map[y][x] = STAIRS; return; }
      }
    }
    map[cy][cx] = STAIRS;
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
    if (!el) return;
    const b = DATA.biomes[biomeOf(depth)];
    el.textContent = b.name + "  " + floorInBiome(depth) + "/5" + (isBossDepth(depth) ? "  ⚔" : "");
  }

  // ---- Combat --------------------------------------------------------------
  function attack(attacker, target, bonus) {
    bonus = bonus || 0;
    if (attacker === player) {
      bump(player, target.x, target.y);
      if (target.evasion && Math.random() < target.evasion) {   // dodge
        floatText(target.x, target.y, "miss", "#cfe6b0");
        log("The " + monName(target) + " dodges.");
        return;
      }
      const watk = player.weapon ? GEAR[player.weapon].atk : 0;
      const dmg = randInt(player.atkMin, player.atkMax) + strBonus() + watk + player.atkBonus;
      target.hp -= dmg;
      flash(target);
      floatText(target.x, target.y, "-" + dmg, "#ffe08a");
      if (target.hp <= 0) {
        monsters = monsters.filter((m) => m !== target);
        log("You strike the " + monName(target) + " — it dies. (-" + dmg + ")", "hit");
        let xp = target.boss ? 15 + Math.round(target.maxHp * 0.4) : target.maxHp;
        if (!target.boss) {                      // over-leveled kills are worth less
          const diff = player.level - (target.level || 1);
          if (diff >= 4) xp = 0;
          else if (diff >= 2) xp = Math.round(xp * 0.5);
        }
        gainXP(xp);
        if (target.boss && !monsters.some((m) => m.boss)) onBossDefeated(target.x, target.y);
      } else {
        log("You strike the " + monName(target) + ". (-" + dmg + ")", "hit");
      }
    } else {
      bump(attacker, player.x, player.y);
      if (player.evasion && Math.random() < player.evasion) {   // player dodge (DEX)
        floatText(player.x, player.y, "miss", "#cfe6b0");
        log("You dodge the " + monName(attacker) + ".");
        return;
      }
      let dmg = randInt(attacker.atkMin, attacker.atkMax) + bonus;
      const adef = player.armor ? GEAR[player.armor].def : 0;
      dmg = Math.max(1, dmg - adef - vitResist());
      player.hp -= dmg;
      flash(player);
      floatText(player.x, player.y, "-" + dmg, "#ff8f84");
      updateHUD();
      const verb = bonus > 0 ? " charges you!" : attacker.ranged ? " strikes from afar." : " hits you.";
      log("The " + monName(attacker) + verb + " (-" + dmg + ")", "hurt");
      if (player.hp <= 0) die();
    }
  }

  function onBossDefeated(x, y) {
    bossActive = false;
    if (biome.final) { win(); return; }
    map[y][x] = STAIRS;             // the way down opens where the boss fell
    explored[y][x] = true;
    player.statPoints += 3;         // boss reward: 3 points to spend later
    log("The " + bossName + " falls — the way opens. (+3 stat points)", "hit");
  }

  function win() {
    dead = true;
    walkPath = [];
    const el = document.getElementById("win");
    if (el) el.hidden = false;
  }

  function gainXP(amount) {
    player.xp += amount;
    let threshold = player.level * 8;
    while (player.xp >= threshold) {
      player.xp -= threshold;
      player.level++;
      const cls = DATA.classes[player.cls] || DATA.classes.warrior;
      player.stats[cls.main] += 2;             // main +2
      player.stats[cls.secondary] += 1;        // secondary +1
      player.statPoints += 1;                  // free point (spend in the tree)
      const nm = computeMaxHp();
      player.hp = Math.min(nm, player.hp + (nm - player.maxHp) + 2);
      player.maxHp = nm;
      player.evasion = playerEvasion();
      log("Level " + player.level + "!  +2 " + cls.main + ", +1 " + cls.secondary + ", +1 point", "hit");
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
    const winEl = document.getElementById("win");
    if (winEl) winEl.hidden = true;
    generateLevel();
    log("A new adventurer enters the dungeon.");
  }

  // ---- Monster turns -------------------------------------------------------
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const SENSE = 8;          // how far a monster notices the player (needs line of sight)
  const CHARGE_MAX = 7;
  const REGEN_EVERY = 40;   // player heals 1 HP every this many turns
  let turns = 0;

  // Bresenham line of sight: true if no wall lies strictly between the tiles.
  function lineOfSight(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (let guard = 0; guard < 200; guard++) {
      if (x === x1 && y === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) return true;
      if (isWall(x, y)) return false;
    }
    return false;
  }
  // A straight 8-way direction toward the player, or null if not aligned.
  function straightDir(m) {
    const dx = player.x - m.x, dy = player.y - m.y;
    if (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) return [Math.sign(dx), Math.sign(dy)];
    return null;
  }
  const canSee = (m) => cheb(m.x, m.y, player.x, player.y) <= SENSE && lineOfSight(m.x, m.y, player.x, player.y);
  function randomFloor() {
    for (let t = 0; t < 30; t++) {
      const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
      if (map[y][x] === FLOOR) return { x, y };
    }
    return null;
  }

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
  function patrolStep(m) {
    if (!m.patrol || (m.x === m.patrol.x && m.y === m.patrol.y)) m.patrol = randomFloor();
    if (!m.patrol) return;
    let best = null, bestD = Infinity;
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!canStep(m.x, m.y, dx, dy)) continue;
      if (nx === player.x && ny === player.y) continue;
      if (monsterAt(nx, ny)) continue;
      const d = cheb(nx, ny, m.patrol.x, m.patrol.y);
      if (d < bestD) { bestD = d; best = [nx, ny]; }
    }
    if (best && bestD < cheb(m.x, m.y, m.patrol.x, m.patrol.y)) { m.x = best[0]; m.y = best[1]; }
    else m.patrol = randomFloor();       // stuck — pick a new destination
  }
  function doCharge(m) {
    const dir = straightDir(m);
    let moved = 0;
    while (cheb(m.x, m.y, player.x, player.y) > 1) {
      const nx = m.x + dir[0], ny = m.y + dir[1];
      if (nx === player.x && ny === player.y) break;
      if (!canStep(m.x, m.y, dir[0], dir[1]) || monsterAt(nx, ny)) break;
      m.x = nx; m.y = ny; moved++;
    }
    if (cheb(m.x, m.y, player.x, player.y) === 1) attack(m, player, moved);  // +1 dmg per tile crossed
  }

  function eligiblePool() {
    const f = floorInBiome(depth);
    return biome.monsters.filter((k) => (VERMIN[k].minFloor || 1) <= f);
  }
  function spawnOne() {
    const pool = eligiblePool();
    if (!pool.length) return;
    for (let t = 0; t < 40; t++) {
      const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
      if (map[y][x] !== FLOOR || visible[y][x] || monsterAt(x, y)) continue;
      if (cheb(x, y, player.x, player.y) < 6) continue;    // arrive out of sight, at a distance
      monsters.push(makeMonster(pool[randInt(0, pool.length - 1)], x, y));
      return;
    }
  }
  function maybeReinforce() {
    if (bossActive) return;
    const every = biome.spawnEvery || 0;
    const cap = biome.spawnCap || 12;
    if (every > 0 && turns % every === 0 && monsters.length < cap) spawnOne();
  }

  function worldTurn() {
    turns++;
    for (const m of monsters.slice()) {
      if (m.hp <= 0) continue;
      const d = cheb(m.x, m.y, player.x, player.y);
      if (d === 1) { attack(m, player); if (dead) return; continue; }
      if (m.ranged && d <= (m.range || 4) && lineOfSight(m.x, m.y, player.x, player.y)) {
        attack(m, player); if (dead) return; continue;
      }
      if (m.charge && d >= 3 && d <= CHARGE_MAX && straightDir(m) && lineOfSight(m.x, m.y, player.x, player.y)) {
        doCharge(m); if (dead) return; continue;
      }
      if (canSee(m)) { if (Math.random() >= m.erratic) stepMonsterToward(m); else stepMonsterRandom(m); }
      else patrolStep(m);
    }
    if (turns % REGEN_EVERY === 0 && player.hp < player.maxHp) {
      player.hp++; updateHUD(); floatText(player.x, player.y, "+1", "#8ed69a");
    }
    maybeReinforce();
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
    if (dead) return;
    if (walkPath.length) { walkPath = []; return; }           // tap while travelling = stop
    if (!inBounds(tx, ty)) return;
    if (anyMonsterVisible()) { stepToward(tx, ty); return; }   // stay in control near danger
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
    const rx = player.rx === undefined ? player.x : player.rx;
    const ry = player.ry === undefined ? player.y : player.ry;
    camX = clamp(rx - (viewCols - 1) / 2, MAP_W - viewCols);   // float: smooth scroll
    camY = clamp(ry - (viewRows - 1) / 2, MAP_H - viewRows);
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

  // ---- Sprites (CC0 Dungeon Crawl Stone Soup tiles) -----------------------
  const SPRITE_NAMES = Array.from(new Set([
    "player", "dagger", "sword", "mace", "leather", "chain", "plate",
    "potion", "scroll", "stairs",
    ...Object.keys(DATA.monsters),                      // rat … harpy
    ...Object.keys(DATA.bosses),                        // piper … demigod
    ...DATA.biomes.flatMap((b) => [b.floor, b.wall]),   // per-biome terrain
    ...DATA.biomes.map((b) => b.exitSprite).filter(Boolean),
  ]));
  const SPRITES = {};
  for (const n of SPRITE_NAMES) {
    const img = new Image();
    img.src = "./assets/tiles/" + n + ".png";
    SPRITES[n] = img;
  }
  const ready = (img) => img && img.complete && img.naturalWidth > 0;
  function drawImg(img, px, py) {
    if (!ready(img)) return false;
    ctx.drawImage(img, px, py, tile, tile);
    return true;
  }
  function dim(px, py, amount) {
    if (amount <= 0) return;
    ctx.fillStyle = "rgba(8,6,3," + amount.toFixed(3) + ")";
    ctx.fillRect(px, py, tile, tile);
  }
  function drawCoin(px, py) {
    const cx = px + tile / 2, cy = py + tile / 2, r = tile * 0.24;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#f0c14b";
    ctx.fill();
    ctx.lineWidth = Math.max(1, tile * 0.05);
    ctx.strokeStyle = "#a9791f";
    ctx.stroke();
  }
  function spriteForItem(key) {
    const d = defOf(key);
    if (d.cat === "weapon" || d.cat === "armor") return SPRITES[key];
    return d.cat === "potion" ? SPRITES.potion : SPRITES.scroll;
  }
  // Draw a sprite preserving its aspect, bottom-anchored in the tile (bosses
  // can be taller than one tile and scale > 1).
  function drawSpriteFit(img, px, py, scale) {
    if (!ready(img)) return false;
    const h = tile * scale;
    const w = h * (img.naturalWidth / img.naturalHeight);
    ctx.drawImage(img, px + (tile - w) / 2, (py + tile) - h, w, h);
    return true;
  }

  // ---- Animation: smooth movement, attack lunges, hit flashes, floaters ----
  const MOVE_MS = 120, BUMP_MS = 130, HIT_MS = 170, FLOAT_MS = 850;
  const easeOut = (p) => 1 - (1 - p) * (1 - p);
  let floaters = [];
  function animEntity(e, now) {
    if (e.rx === undefined) { e.rx = e.x; e.ry = e.y; e.lx = e.x; e.ly = e.y; e.ax = e.x; e.ay = e.y; e.at = 0; }
    if (e.x !== e.lx || e.y !== e.ly) { e.ax = e.rx; e.ay = e.ry; e.at = now; e.lx = e.x; e.ly = e.y; }
    if (reduceMotion) { e.rx = e.x; e.ry = e.y; return; }
    const k = easeOut(Math.min(1, (now - e.at) / MOVE_MS));
    e.rx = e.ax + (e.x - e.ax) * k;
    e.ry = e.ay + (e.y - e.ay) * k;
  }
  function bumpOffset(e, now) {
    if (reduceMotion || !e.bumpAt) return [0, 0];
    const p = (now - e.bumpAt) / BUMP_MS;
    if (p >= 1) return [0, 0];
    const a = Math.sin(Math.PI * p) * 0.35;
    return [(e.bumpDx || 0) * a, (e.bumpDy || 0) * a];
  }
  function bump(attacker, tx, ty) {
    attacker.bumpDx = Math.sign(tx - attacker.x);
    attacker.bumpDy = Math.sign(ty - attacker.y);
    attacker.bumpAt = performance.now();
  }
  const flash = (e) => { e.hitAt = performance.now(); };
  const floatText = (x, y, text, color) => floaters.push({ x, y, text, color, at: performance.now() });
  function snapPlayer() {
    player.rx = player.x; player.ry = player.y;
    player.lx = player.x; player.ly = player.y;
    player.ax = player.x; player.ay = player.y; player.at = 0;
  }
  function updateAnims(now) {
    animEntity(player, now);
    for (const m of monsters) animEntity(m, now);
    floaters = floaters.filter((f) => now - f.at < FLOAT_MS);
  }

  // ---- Draw: dungeon view --------------------------------------------------
  function hitFlash(e, px, py, now) {
    if (!e.hitAt) return;
    const p = (now - e.hitAt) / HIT_MS;
    if (p >= 1) return;
    ctx.fillStyle = "rgba(255,255,255," + ((1 - p) * 0.5).toFixed(3) + ")";
    ctx.fillRect(px, py, tile, tile);
  }

  function draw(now) {
    updateCamera();
    ctx.imageSmoothingEnabled = false;   // crisp pixel art (reset when canvas resizes)
    ctx.fillStyle = "#0c0905";
    ctx.fillRect(0, 0, viewCols * tile, viewRows * tile);
    const SX = (mx) => (mx - camX) * tile;
    const SY = (my) => (my - camY) * tile;

    // terrain (one tile of margin so fractional scrolling leaves no gaps)
    const x0 = Math.floor(camX) - 1, y0 = Math.floor(camY) - 1;
    for (let my = y0; my <= y0 + viewRows + 2; my++) {
      for (let mx = x0; mx <= x0 + viewCols + 2; mx++) {
        if (!inBounds(mx, my) || !explored[my][mx]) continue;
        const vis = visible[my][mx];
        const b = vis ? litBright(mx, my) : MEM;
        const px = SX(mx), py = SY(my);
        const t = map[my][mx];
        if (t === WALL) {
          if (!drawImg(SPRITES[biome.wall], px, py)) { ctx.fillStyle = shade(COL.wallFace, b); ctx.fillRect(px, py, tile, tile); }
        } else {
          if (!drawImg(SPRITES[biome.floor], px, py)) {
            ctx.fillStyle = shade((mx + my) % 2 === 0 ? COL.floorA : COL.floorB, b);
            ctx.fillRect(px, py, tile, tile);
          }
          if (t === STAIRS) drawImg(SPRITES[biome.exitSprite || "stairs"], px, py);
        }
        dim(px, py, 1 - b);                                   // torch falloff / memory
        if (!vis) { ctx.fillStyle = "rgba(70,90,130,0.10)"; ctx.fillRect(px, py, tile, tile); }
      }
    }

    // route markers
    for (const s of walkPath) {
      if (!inBounds(s.x, s.y) || !explored[s.y][s.x]) continue;
      const px = SX(s.x), py = SY(s.y);
      const sz = tile * 0.2;
      ctx.fillStyle = "rgba(246,184,69,0.18)";
      ctx.fillRect(px + (tile - sz) / 2, py + (tile - sz) / 2, sz, sz);
    }

    // floor items
    for (const it of items) {
      if (!inBounds(it.x, it.y) || !visible[it.y][it.x]) continue;
      const px = SX(it.x), py = SY(it.y);
      if (it.key === "gold") drawCoin(px, py);
      else drawImg(spriteForItem(it.key), px, py);
      dim(px, py, (1 - litBright(it.x, it.y)) * 0.8);
    }

    // monsters (glide + lunge + flash; bosses render larger)
    for (const m of monsters) {
      if (m.hp <= 0 || !inBounds(m.x, m.y) || !visible[m.y][m.x]) continue;
      const [bx, by] = bumpOffset(m, now);
      const px = SX(m.rx + bx), py = SY(m.ry + by);
      drawSpriteFit(SPRITES[m.type], px, py, m.boss ? 1.5 : 1);
      dim(px, py, (1 - litBright(m.x, m.y)) * 0.8);
      hitFlash(m, px, py, now);
      if (!m.boss && m.hp < m.maxHp) {
        const bw = tile * 0.7, bh = Math.max(2, tile * 0.09);
        const hx = px + (tile - bw) / 2, hy = py + tile * 0.06;
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(hx, hy, bw, bh);
        ctx.fillStyle = "#d9584a"; ctx.fillRect(hx, hy, bw * (m.hp / m.maxHp), bh);
      }
    }

    // player, with a torch glow (glide + lunge + flash)
    const [pbx, pby] = bumpOffset(player, now);
    const px = SX(player.rx + pbx), py = SY(player.ry + pby);
    const cx = px + tile / 2, cy = py + tile / 2;
    const glow = ctx.createRadialGradient(cx, cy, tile * 0.1, cx, cy, tile * 2.4);
    glow.addColorStop(0, "rgba(246,184,69,0.24)");
    glow.addColorStop(1, "rgba(246,184,69,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - tile * 3, cy - tile * 3, tile * 6, tile * 6);
    if (!drawImg(SPRITES.player, px, py)) {
      ctx.fillStyle = "#f6b845";
      ctx.font = `700 ${Math.floor(tile * 0.8)}px ${bodyFont()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("@", cx, cy);
    }
    hitFlash(player, px, py, now);

    // floating damage numbers
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(11, Math.floor(tile * 0.5))}px ${bodyFont()}`;
    for (const f of floaters) {
      const p = (now - f.at) / FLOAT_MS;
      const fx = SX(f.x) + tile / 2, fy = SY(f.y) + tile / 2 - p * tile * 0.9;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(f.text, fx + 1, fy + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, fx, fy);
    }
    ctx.globalAlpha = 1;

    // boss health banner
    const bosses = monsters.filter((m) => m.boss && inBounds(m.x, m.y) && visible[m.y][m.x]);
    if (bosses.length) drawBossBar(bosses);
  }

  function drawBossBar(bosses) {
    const cur = bosses.reduce((s, m) => s + Math.max(0, m.hp), 0);
    const max = bosses.reduce((s, m) => s + m.maxHp, 0);
    const w = viewCols * tile;
    const bw = Math.min(w - 24, 360);
    const bx = (w - bw) / 2, by = 14, bh = 12;
    ctx.fillStyle = "rgba(6,4,2,0.72)";
    ctx.fillRect(bx - 10, by - 10, bw + 20, bh + 34);
    ctx.fillStyle = "#ece2cf";
    ctx.font = `700 12px ${bodyFont()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const label = bosses.length > 1 ? bossName + " ×" + bosses.length : bossName;
    ctx.fillText(label.toUpperCase(), bx + bw / 2, by - 4);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx, by + 12, bw, bh);
    ctx.fillStyle = "#d9584a";
    ctx.fillRect(bx, by + 12, bw * (cur / Math.max(1, max)), bh);
    ctx.strokeStyle = "rgba(240,168,56,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 12.5, bw, bh);
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
    const b = strBonus() + player.atkBonus + w;
    return (player.atkMin + b) + "–" + (player.atkMax + b);
  }
  function renderInv() {
    document.getElementById("invGold").textContent = player.gold + " gold";
    const df = (player.armor ? GEAR[player.armor].def : 0) + vitResist();
    const cname = (DATA.classes[player.cls] || {}).name || "Adventurer";
    const s = player.stats;
    const statLine = `STR ${s.STR} · VIT ${s.VIT} · DEX ${s.DEX} · INT ${s.INT} · RES ${s.RES} · LCK ${s.LCK}`;
    const pts = player.statPoints > 0 ? `  ·  <b style="color:#f0c14b">${player.statPoints} pts</b>` : "";
    document.getElementById("invStats").innerHTML =
      `${cname} · Lv ${player.level} · Atk ${playerAtk()} · Def ${df}` +
      `<br><span style="opacity:.85">${statLine}${pts}</span>`;
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
      player.stats.STR += 1;
      log("Strength surges through your arms. (+1 STR)", "hit");
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
        if (passable(x, y) && !monsterAt(x, y)) { player.x = x; player.y = y; computeFOV(); snapPlayer(); break; }
      }
      log("Reality lurches — you stand somewhere new.");
    }
  }

  // ---- Main loop -----------------------------------------------------------
  const STEP_MS = 130;   // pace of auto-walk steps (kept just above the glide time)
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
    updateAnims(t);
    if (mapOpen) drawMap();
    else draw(t);
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
    if (key === "z" || e.key === "." || e.code === "Numpad5") { e.preventDefault(); waitTurn(); return; }
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
  function waitTurn() { if (dead || mapOpen || invOpen) return; walkPath = []; worldTurn(); }
  document.getElementById("btnWait").addEventListener("click", waitTurn);
  mapCanvas.addEventListener("click", () => toggleMap(false));

  // tap outside the pack card closes it
  const invOverlay = document.getElementById("inv");
  invOverlay.addEventListener("click", (e) => { if (e.target === invOverlay) toggleInv(false); });
  document.getElementById("invClose").addEventListener("click", () => toggleInv(false));

  for (const id of ["gameover", "win"]) {
    const el = document.getElementById(id);
    el.addEventListener("click", restart);
    el.addEventListener("touchstart", (e) => { e.preventDefault(); restart(); }, { passive: false });
  }

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
    const colF = (clientX - rect.left) / (rect.width / viewCols);
    const rowF = (clientY - rect.top) / (rect.height / viewRows);
    return [Math.floor(camX + colF), Math.floor(camY + rowF)];
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
        cls: player.cls, stats: Object.assign({}, player.stats), statPoints: player.statPoints,
        atk: playerAtk(), atkBonus: player.atkBonus, gold: player.gold, weapon: player.weapon, armor: player.armor,
        inv: player.inv.map((i) => i.key), identified: [...identified],
        x: player.x, y: player.y, dead, explored: ex,
        biome: biome ? biome.name : null, floor: floorInBiome(depth), bossActive,
        hasStairs: map.some((row) => row.includes(STAIRS)),
        monsters: monsters.length,
        mlist: monsters.map((m) => ({ x: m.x, y: m.y, type: m.type, hp: m.hp, level: m.level, ranged: !!m.ranged, charge: !!m.charge, evasion: m.evasion || 0 })),
        items: items.map((it) => ({ x: it.x, y: it.y, key: it.key })),
      };
    },
    useIdx: (i) => actItem(i),
    step: (dx, dy) => playerAct(dx, dy),
    place: (x, y) => { if (passable(x, y)) { player.x = x; player.y = y; computeFOV(); snapPlayer(); } },
    tap: (x, y) => walkTo(x, y),
    walking: () => walkPath.length,
    tick: () => { if (!dead) worldTurn(); },
    turns: () => turns,
  };

  // ---- Go ------------------------------------------------------------------
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();
  resetPlayer();
  generateLevel();
  updateHUD();
  requestAnimationFrame(frame);
})();
