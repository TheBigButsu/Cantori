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
  const MAP_W = 51;         // a big sprawling floor: same total room area, spread out
  const MAP_H = 51;         // with long, winding, 3-wide corridors between chambers
  const FOV_RADIUS = 8;     // max line of sight: you see 8 tiles out (walls/closed
                            // doors block); rooms reveal as you move into them

  const WALL = 0;
  const FLOOR = 1;
  const STAIRS = 2;
  const DOOR = 3;              // hall entrance; passable, but a *closed* door blocks sight
  const THORN = 4;             // bramble barrier: you can push through, but it hurts

  let map = [];
  let visible = [];
  let explored = [];        // revealed on the map (own eyes OR magic mapping)
  let beenSeen = [];        // actually held in FOV at some point (not just mapped)
  let genStats = null;      // last level's room/corridor/floor fill breakdown
  let torches = [];            // decorative wall-mounted torches {x, y}
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

  // Stats → effects (INT / RES / LCK come later)
  const UNARMED_MIN = 2, UNARMED_MAX = 3;
  const HP_BASE = 13, HP_PER_VIT = 1;     // 1 point of VIT = 1 HP (warrior: 13 + VIT ≈ 20)
  const ACC_BASE = 10, EVA_BASE = 1;      // DEX → accuracy & evasion
  const MON_ACC = 12, MON_EVA = 4;        // monster defaults when unspecified
  const weaponStrReq = () => (player.weapon && GEAR[player.weapon.key].req ? (GEAR[player.weapon.key].req.STR || 0) : 0);
  const strBonus = () => Math.max(0, Math.floor((eff("STR") - weaponStrReq()) / 4)); // STR vs weapon req → damage
  // maxHp = VIT-based health + flat per-level HP from the class's levelUp set
  const computeMaxHp = () => { const cls = DATA.classes[player.cls] || {}; return (cls.baseHp != null ? cls.baseHp : HP_BASE) + eff("VIT") * HP_PER_VIT + (player.lvlHp || 0); };
  const playerAcc = () => ACC_BASE + eff("DEX") + weaponAccuracy() + (player.lvlAcc || 0) + passiveMod("acc");  // DEX + weapon + level + skills
  const playerEva = () => EVA_BASE + eff("DEX") + (player.lvlEva || 0) + armorSubEva() + passiveMod("eva");     // DEX + level + armor weight + skills
  // Critical hits: 5% chance to deal 200% damage by default, each grown by the
  // class's per-level crit / critDmg gains (added, not multiplied).
  const BASE_CRIT = 5, BASE_CRIT_DMG = 200;
  const critChance = () => (BASE_CRIT + (player.lvlCrit || 0)) / 100;
  const critMult = () => (BASE_CRIT_DMG + (player.lvlCritDmg || 0)) / 100;
  const vitResist = () => Math.floor(eff("VIT") / 5);                  // VIT → damage resist
  // hit chance = attacker accuracy / (accuracy + defender evasion)
  // To-hit is difference-based and easy to read: 50% at even acc/eva, then ±3%
  // for each point of accuracy over (or under) evasion, clamped to 10%–95%.
  const hitChance = (acc, eva) => Math.max(0.10, Math.min(0.95, 0.5 + (acc - eva) * 0.03));
  const rollHit = (acc, eva) => Math.random() < hitChance(acc, eva);

  const player = {
    x: 0, y: 0, hp: 20, maxHp: 20, atkMin: UNARMED_MIN, atkMax: UNARMED_MAX,
    atkBonus: 0, weapon: null, armor: null, ring1: null, ring2: null, trinket: null, necklace: null,
    inv: [], gold: 0, xp: 0, level: 1,
    cls: "warrior", stats: { STR: 5, INT: 5, VIT: 5, DEX: 5, RES: 5, LCK: 5 },
    statPoints: 0,
    mp: 5, maxMp: 5, lvlHp: 0, lvlAcc: 0, lvlEva: 0,   // per-level flat bonuses (class levelUp set)
    lvlCrit: 0, lvlCritDmg: 0,                         // per-level crit% and crit-damage% gains
    regenAcc: 0, mpRegenAcc: 0,                        // fractional HP / MP regen carry-over
  };
  // Equipment slots: cat -> which player field(s) it fills.
  const EQUIP_SLOTS = { weapon: ["weapon"], armor: ["armor"], ring: ["ring1", "ring2"], trinket: ["trinket"], necklace: ["necklace"] };
  const ALL_SLOTS = ["weapon", "armor", "ring1", "ring2", "trinket", "necklace"];
  const wornItems = () => ALL_SLOTS.map((s) => player[s]).filter(Boolean);
  function applyClass(key) {
    const c = DATA.classes[key] || DATA.classes.warrior;
    player.cls = key;
    player.stats = Object.assign({ STR: 5, INT: 5, VIT: 5, DEX: 5, RES: 5, LCK: 5 }, c.stats || {});
    player.statPoints = 0; player.atkBonus = 0;
    player.atkMin = UNARMED_MIN; player.atkMax = UNARMED_MAX;
    player.weapon = null; player.armor = null;
    player.ring1 = null; player.ring2 = null; player.trinket = null; player.necklace = null;
    player.inv = []; player.gold = 0;
    player.xp = 0; player.level = 1;
    player.lvlHp = 0; player.lvlAcc = 0; player.lvlEva = 0;   // reset per-level bonuses
    player.lvlCrit = 0; player.lvlCritDmg = 0;
    player.regenAcc = 0; player.mpRegenAcc = 0;
    player.maxMp = c.baseMp || 0; player.mp = player.maxMp;
    identified.clear();
    player.stoneSkin = null;                   // timed buffs don't carry across a new run
    player.boons = new Set();                  // boons are earned fresh each run
    assignPotionLooks();                        // scramble unidentified potion colours for this run
    _skillCache = { cls: null, skills: {}, byPos: {} };   // force a rebuild for the new class
    player.skills = {};
    const sk = treeSkills(key).skills;
    for (const k of Object.keys(sk)) player.skills[k] = { rank: 0, cd: 0 };
    if (c.start) {                             // starting kit (plain white), already equipped
      if (c.start.weapon && GEAR[c.start.weapon]) player.weapon = mkBase(c.start.weapon);
      if (c.start.armor && GEAR[c.start.armor]) player.armor = mkBase(c.start.armor);
    }
    player.maxHp = computeMaxHp();             // after gear, so VIT affixes count
    player.hp = player.maxHp;
  }
  function resetPlayer() { applyClass(player.cls || "warrior"); }
  let monsters = [];
  let items = [];
  let traps = [];
  let walkPath = [];
  const trapAt = (x, y) => traps.find((t) => t.x === x && t.y === y) || null;

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const isWall = (x, y) => !inBounds(x, y) || map[y][x] === WALL;
  const isDoor = (x, y) => inBounds(x, y) && map[y][x] === DOOR;
  const isThorn = (x, y) => inBounds(x, y) && map[y][x] === THORN;
  const passable = (x, y) => inBounds(x, y) && map[y][x] !== WALL;
  // A door is open only while you stand on it, then swings/grows shut behind you —
  // an open/close mechanism (the forest bushes "come back").
  const doorOpen = (x, y) => player.x === x && player.y === y;
  // Sight (FOV + line of sight) is blocked by walls and by *closed* doors — so a
  // room stays hidden until you reach its doorway, enabling surprise ambushes.
  const blocksSight = (x, y) => !inBounds(x, y) || map[y][x] === WALL || (map[y][x] === DOOR && !doorOpen(x, y));

  function blankGrid(fill) {
    const g = [];
    for (let y = 0; y < MAP_H; y++) g.push(new Array(MAP_W).fill(fill));
    return g;
  }

  // ---- Content data (edit game content in data.js) ------------------------
  // The admin editor (editor.html) can stash a draft in localStorage to playtest
  // changes before they're committed; use it if present and structurally sane.
  let usingDraft = false;
  const DATA = (() => {
    try {
      const raw = localStorage.getItem("cantori_data_override");
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.monsters && d.gear && d.biomes && d.consumables) {
          if (window.console) console.log("Cantori: using editor draft from localStorage.");
          usingDraft = true;
          return d;
        }
      }
    } catch (e) { /* fall back to the shipped data */ }
    return window.CANTORI_DATA;
  })();
  const VERMIN = DATA.monsters;
  const VERMIN_KEYS = Object.keys(VERMIN);
  const monsterAt = (x, y) => monsters.find((m) => m.hp > 0 && m.x === x && m.y === y) || null;
  const anyMonsterVisible = () =>
    monsters.some((m) => m.hp > 0 && inBounds(m.x, m.y) && visible[m.y][m.x]);

  // ---- Loot: weapons & armor (defined in data.js) -------------------------
  const GEAR = DATA.gear;
  const GEAR_KEYS = Object.keys(GEAR);
  const itemAt = (x, y) => items.find((it) => it.x === x && it.y === y) || null;

  // ---- Loot system: rarity + affixes ---------------------------------------
  const LOOT = DATA.loot;
  const RARITY = {};                       // key -> {name,chance,color}
  for (const r of LOOT.rarities) RARITY[r.key] = r;
  const isGear = (it) => it && GEAR[it.key];              // a rolled gear instance (vs consumable/gold)
  const rarityColor = (k) => (RARITY[k] ? RARITY[k].color : "#e6e0d2");

  // Roll logic lives in loot.js (a self-contained module) — wire it up here.
  const _loot = window.CantoriLoot({ GEAR, GEAR_KEYS, LOOT, randInt: (lo, hi) => randInt(lo, hi) });
  const rollRarity = _loot.rollRarity;
  const maxPlusForFloor = _loot.maxPlusForFloor;
  const rollItem = _loot.rollItem;
  const rollGearDrop = _loot.rollGearDrop;
  const rollTrinket = _loot.rollTrinket;

  // A plain, already-known base item (starting kit, gold/authored items).
  const mkBase = (key) => ({ key, rarity: "white", plus: 0, stats: [], enchants: [], idNeed: 0, idXp: 0, identified: true });
  // Copy an item instance without its map position (for pack/equip moves).
  function stripPos(it) { const o = Object.assign({}, it); delete o.x; delete o.y; delete o.amount; return o; }

  // Effective numbers for an instance (base + plus).
  const gDmgMin = (inst) => (GEAR[inst.key].dmgMin || 0) + (inst.plus || 0);
  const gDmgMax = (inst) => (GEAR[inst.key].dmgMax || 0) + (inst.plus || 0);
  // Armor blocks a random amount each hit, rolled between defMin and defMax. A
  // legacy flat `def` still works — it becomes both ends of the range.
  const baseDefMin = (key) => { const g = GEAR[key]; return g.defMin != null ? g.defMin : (g.def || 0); };
  const baseDefMax = (key) => { const g = GEAR[key]; return g.defMax != null ? g.defMax : (g.def != null ? g.def : (g.defMin || 0)); };
  const gDefMin = (inst) => baseDefMin(inst.key) + (inst.plus || 0);
  const gDefMax = (inst) => baseDefMax(inst.key) + (inst.plus || 0);
  const gDef = (inst) => gDefMax(inst);   // top-end block (enchant power, parallels weapon dmgMax)
  const gStatBonus = (inst, statKey) => {
    let n = 0;
    for (const s of inst.stats || []) if (s.stat === statKey) n += s.val + (inst.plus || 0);
    return n;
  };
  // Sum a stat bonus across every equipped item (weapon, armor, rings, trinket, necklace).
  function equipStat(statKey) {
    let n = 0;
    for (const it of wornItems()) n += gStatBonus(it, statKey);
    return n;
  }
  const eff = (statKey) => player.stats[statKey] + equipStat(statKey);   // base + gear
  // Extra flat mitigation from "Defense" enchants worn on armor / jewelry.
  function wornDefense() {
    let d = 0;
    for (const it of wornItems()) {
      if (!it || !it.enchants) continue;
      for (const e of it.enchants) {
        const def = LOOT.enchants[e];
        if (def && def.effect && def.effect.type === "defense") d += (def.effect.amount || 0);
      }
    }
    return d;
  }
  // Stone Skin (a potion buff): while it lasts, each block gets a bonus rolled
  // between level/2 and (level + floor + VIT)/2.
  const stoneSkinActive = () => !!(player.stoneSkin && player.stoneSkin.turns > 0);
  const stoneSkinLo = () => (stoneSkinActive() ? Math.floor(player.level / 2) : 0);
  const stoneSkinHi = () => (stoneSkinActive() ? Math.floor((player.level + depth + eff("VIT")) / 2) : 0);
  const stoneSkinRoll = () => (stoneSkinActive() ? randInt(Math.min(stoneSkinLo(), stoneSkinHi()), Math.max(stoneSkinLo(), stoneSkinHi())) : 0);
  const armorFlat = () => armorSubMit() + wornDefense();          // flat, always-on mitigation
  const armorDef = () => (player.armor ? gDef(player.armor) : 0) + armorFlat() + stoneSkinHi();          // top-end block (display/peek)
  const armorDefMin = () => (player.armor ? gDefMin(player.armor) : 0) + armorFlat() + stoneSkinLo();
  const armorDefMax = () => (player.armor ? gDefMax(player.armor) : 0) + armorFlat() + stoneSkinHi();
  // The actual mitigation applied on a hit: roll a fresh block within the range.
  const armorBlock = () => (player.armor ? randInt(Math.min(gDefMin(player.armor), gDefMax(player.armor)), Math.max(gDefMin(player.armor), gDefMax(player.armor))) : 0) + armorFlat() + stoneSkinRoll();
  // Weapon combat numbers (unarmed falls back to the base 2–3 fists).
  const weaponDmgMin = () => (player.weapon ? gDmgMin(player.weapon) : player.atkMin);
  const weaponDmgMax = () => (player.weapon ? gDmgMax(player.weapon) : player.atkMax);
  const weaponAccuracy = () => (player.weapon ? (GEAR[player.weapon.key].accuracy || 0) : 0);
  const weaponSpeed = () => (player.weapon ? (GEAR[player.weapon.key].speed || 1) : 1);
  // Weapon reach: 1 = melee (adjacent only). Spears/bows carry a range > 1 and
  // can strike a monster that far away with line of sight.
  const weaponRange = () => (player.weapon ? (GEAR[player.weapon.key].range || 1) : 1);
  const weaponSub = () => (player.weapon ? (GEAR[player.weapon.key].sub || "") : "");
  // Armor subtype: lighter armor dodges better (evasion), heavier mitigates more
  // damage on top of the item's def. Tunable here.
  const ARMOR_SUB = { light: { eva: 3, mit: 0 }, medium: { eva: 0, mit: 1 }, heavy: { eva: -3, mit: 3 } };
  const armorSub = () => (player.armor ? (ARMOR_SUB[GEAR[player.armor.key].sub] || null) : null);
  const armorSubEva = () => { const a = armorSub(); return a ? (a.eva || 0) : 0; };
  const armorSubMit = () => { const a = armorSub(); return a ? (a.mit || 0) : 0; };
  // Passive "haste" from worn Speed enchants — makes your attacks cost less time.
  function wornHaste() {
    let h = 0;
    for (const it of wornItems()) {
      if (!it || !it.enchants) continue;
      for (const e of it.enchants) {
        const def = LOOT.enchants[e];
        if (def && def.effect && def.effect.type === "haste") h += (def.effect.mult || 0);
      }
    }
    return h;
  }
  const playerActSpeed = () => weaponSpeed() * (1 + wornHaste());
  // The Metrognome trinket: a worn one grants +1 to EITHER walk speed or attack
  // speed (its rolled variant), never both. Lower action-cost = you act more often
  // relative to monsters.
  const metroMode = () => (player.trinket && player.trinket.key === "metrognome" ? player.trinket.variant : null);
  const walkCost = () => (metroMode() === "walk" ? 0.5 : 1);                       // +1 walk speed → half the cost
  const attackCost = () => 1 / (playerActSpeed() + (metroMode() === "attack" ? 1 : 0));
  // The "power" an item's enchant procs at: weapon top-end damage, armor defense,
  // or (for jewelry) its tier + plus.
  function itemPower(inst) {
    const cat = GEAR[inst.key].cat;
    if (cat === "weapon") return gDmgMax(inst);
    if (cat === "armor") return gDef(inst);
    return (GEAR[inst.key].tier || 1) + (inst.plus || 0);
  }

  // Identification: gear reveals its magic (rarity, +X, affixes) only once you've
  // learned it through use; the base item type is always visible. Consumables use
  // the by-key `identified` set. The item still works fully while unidentified —
  // you just can't read its numbers yet.
  const itemIdentified = (inst) => (isGear(inst) ? !!inst.identified : identified.has(inst.key));
  const dispPlus = (inst) => (itemIdentified(inst) ? (inst.plus || 0) : 0);
  const itemColor = (inst) => ((isGear(inst) && itemIdentified(inst)) ? rarityColor(inst.rarity) : "#cfc3a0");
  // Display damage/def hide the +X until identified (combat still uses the real gDmg*/gDef).
  const dDmgMin = (inst) => (GEAR[inst.key].dmgMin || 0) + dispPlus(inst);
  const dDmgMax = (inst) => (GEAR[inst.key].dmgMax || 0) + dispPlus(inst);
  const dDefMin = (inst) => baseDefMin(inst.key) + dispPlus(inst);
  const dDefMax = (inst) => baseDefMax(inst.key) + dispPlus(inst);
  const dDef = (inst) => dDefMax(inst);
  // "3" if the block is fixed, "1–3" if it's a range — for gear labels.
  const defRange = (lo, hi) => (lo === hi ? "" + lo : lo + "–" + hi);
  const idPct = (inst) => (itemIdentified(inst) ? 100 : Math.min(99, Math.floor(((inst.idXp || 0) / Math.max(1, inst.idNeed || 1)) * 100)));

  // Display: colored name, +X prefix (only if known), and an affix summary line.
  function itemName(inst) {
    if (!isGear(inst)) return displayName(inst.key);
    const p = dispPlus(inst) > 0 ? "+" + dispPlus(inst) + " " : "";
    return p + GEAR[inst.key].name;
  }
  function itemAffixText(inst) {
    if (!isGear(inst)) return "";
    const parts = [];
    const g = GEAR[inst.key];
    if (g.cat === "weapon") {   // base weapon feel is intrinsic — always shown
      if (g.speed != null && g.speed !== 1) parts.push("spd " + g.speed);
      if (g.accuracy) parts.push("acc " + (g.accuracy > 0 ? "+" : "") + g.accuracy);
    }
    if (!itemIdentified(inst)) { parts.push("unidentified"); return parts.join(", "); }
    if (inst.variant === "walk") parts.push("+1 walk speed");
    else if (inst.variant === "attack") parts.push("+1 attack speed");
    for (const s of inst.stats || []) parts.push("+" + (s.val + (inst.plus || 0)) + " " + s.stat);
    for (const e of inst.enchants || []) { const d = LOOT.enchants[e]; parts.push((d ? d.icon + " " + d.name : e)); }
    return parts.join(", ");
  }

  // ---- Loot: potions & scrolls, identified by use (defined in data.js) ----
  const CONSUM = DATA.consumables;
  const CONSUM_KEYS = Object.keys(CONSUM);
  const TRAPS = DATA.traps || {};
  const TRAP_KEYS = Object.keys(TRAPS);
  const identified = new Set();
  const defOf = (key) => GEAR[key] || CONSUM[key];
  // Unidentified potions look different every run: each potion key is assigned a
  // random shade + colour, so you can't tell them apart until you drink one. Two
  // potions with the same shade this run really are the same potion.
  const POTION_SHADES = [
    ["Crimson", "#c0392b"], ["Azure", "#3d7fd6"], ["Emerald", "#2ecc71"],
    ["Amber", "#e0a838"], ["Violet", "#9b59b6"], ["Rose", "#e07aa0"],
    ["Teal", "#20b2aa"], ["Pearl", "#d8dce2"], ["Ivory", "#ece0c0"],
    ["Umber", "#8a5a2b"], ["Cobalt", "#3454c4"], ["Scarlet", "#e04a3a"],
    ["Jade", "#4fbf8f"], ["Ochre", "#c9922e"], ["Indigo", "#5b4fd0"],
    ["Charcoal", "#6a7078"],
  ];
  const potionLook = {};   // key -> { name, color } for the current run
  function assignPotionLooks() {
    for (const k of Object.keys(potionLook)) delete potionLook[k];
    const shades = POTION_SHADES.slice();
    for (let i = shades.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = shades[i]; shades[i] = shades[j]; shades[j] = t; }
    let si = 0;
    for (const k of Object.keys(CONSUM)) {
      if (CONSUM[k].cat !== "potion") continue;
      const s = shades[si % shades.length]; si++;
      potionLook[k] = { name: s[0], color: s[1] };
    }
  }
  // The colour a consumable shows at: an unidentified potion wears its scrambled
  // shade; everything else uses its authored colour.
  function consumColor(key) {
    const d = CONSUM[key];
    if (!d) return "#cfc3a0";
    if (d.cat === "potion" && !identified.has(key) && potionLook[key]) return potionLook[key].color;
    return d.color || "#cfc3a0";
  }
  function displayName(key) {
    const d = defOf(key);
    if (d.cat === "weapon" || d.cat === "armor" || d.cat === "tool" || identified.has(key)) return d.name;
    if (d.cat === "potion") return (potionLook[key] ? potionLook[key].name + " Potion" : "Unidentified Potion");
    return "Unidentified Scroll";
  }
  function weightedConsumKey() {
    const pool = CONSUM_KEYS.filter((k) => !CONSUM[k].noDrop);   // torch etc. never drop as loot
    if (!pool.length) return CONSUM_KEYS[0];
    // Honour each consumable's `weight` (default 1) so authored rarity matters —
    // e.g. healing common, the newer specialty potions rarer.
    let total = 0; for (const k of pool) total += Math.max(0, CONSUM[k].weight != null ? CONSUM[k].weight : 1);
    if (total <= 0) return pool[randInt(0, pool.length - 1)];
    let r = Math.random() * total;
    for (const k of pool) { r -= Math.max(0, CONSUM[k].weight != null ? CONSUM[k].weight : 1); if (r <= 0) return k; }
    return pool[pool.length - 1];
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
  // A winding orthogonal path from a→b: strictly alternates axes so it bends after
  // every leg (an L, or a staircase), with short legs. Used for 1-wide hallways.
  function orthPath(ax, ay, bx, by) {
    const clampX = (v) => Math.max(2, Math.min(MAP_W - 3, v));
    const clampY = (v) => Math.max(2, Math.min(MAP_H - 3, v));
    const pts = [[ax, ay]];
    let x = ax, y = ay, last = -1, guard = 0;
    while ((x !== bx || y !== by) && guard++ < 400) {
      const dx = bx - x, dy = by - y;
      let axis;
      if (dx !== 0 && dy !== 0) axis = (last === 0) ? 1 : (last === 1 ? 0 : (Math.abs(dx) >= Math.abs(dy) ? 0 : 1));
      else if (dx !== 0) axis = 0;
      else if (dy !== 0) axis = 1;
      else break;
      if (axis === last) {                          // would repeat an axis → jog perpendicular to force a bend
        const j = 1 - axis, jdir = Math.random() < 0.5 ? 1 : -1, jlen = randInt(3, 5);
        for (let i = 0; i < jlen; i++) { if (j === 0) x = clampX(x + jdir); else y = clampY(y + jdir); pts.push([x, y]); }
        last = j; continue;
      }
      const dir = axis === 0 ? Math.sign(dx) : Math.sign(dy);
      const remain = axis === 0 ? Math.abs(dx) : Math.abs(dy);
      const len = Math.min(remain, randInt(3, 6));   // short legs → the 3-wide carve keeps straight runs ≤ ~8
      for (let i = 0; i < len; i++) { if (axis === 0) x = clampX(x + dir); else y = clampY(y + dir); pts.push([x, y]); }
      last = axis;
    }
    // guarantee arrival (connectivity trumps the aesthetic cap in the rare fallback)
    while (x !== bx) { x += Math.sign(bx - x); pts.push([x, y]); }
    while (y !== by) { y += Math.sign(by - y); pts.push([x, y]); }
    return pts;
  }
  // A 1-wide winding hallway between two points (an L or a short staircase).
  function carveCorridor(a, b) {
    for (const [x, y] of orthPath(a.x, a.y, b.x, b.y)) if (map[y][x] === WALL) map[y][x] = FLOOR;
  }
  // Try to place a new w×h room flush against an existing one with a single wall
  // between (an "attached" room — no hallway, just a doorway). Returns the rect,
  // its partner index, and the wall tile to open, or null if it won't fit.
  function placeAdjacent(rooms, w, h) {
    for (let tries = 0; tries < 24; tries++) {
      const pi = randInt(0, rooms.length - 1), r = rooms[pi], side = randInt(0, 3);
      let rect;
      if (side === 0) rect = { x: r.x + r.w + 1, y: r.y + randInt(-(h - 3), r.h - 3), w, h };       // east
      else if (side === 1) rect = { x: r.x - 1 - w, y: r.y + randInt(-(h - 3), r.h - 3), w, h };     // west
      else if (side === 2) rect = { x: r.x + randInt(-(w - 3), r.w - 3), y: r.y + r.h + 1, w, h };   // south
      else rect = { x: r.x + randInt(-(w - 3), r.w - 3), y: r.y - 1 - h, w, h };                     // north
      if (rect.x < 2 || rect.y < 2 || rect.x + rect.w > MAP_W - 2 || rect.y + rect.h > MAP_H - 2) continue;
      if (rooms.some((k, ki) => ki !== pi && overlaps(k, rect, 1))) continue;   // clear of every OTHER room
      let door;
      if (side === 0 || side === 1) {
        const lo = Math.max(r.y, rect.y) + 1, hi = Math.min(r.y + r.h, rect.y + rect.h) - 2;
        if (hi < lo) continue;
        door = { x: side === 0 ? r.x + r.w : r.x - 1, y: randInt(lo, hi) };
      } else {
        const lo = Math.max(r.x, rect.x) + 1, hi = Math.min(r.x + r.w, rect.x + rect.w) - 2;
        if (hi < lo) continue;
        door = { x: randInt(lo, hi), y: side === 2 ? r.y + r.h : r.y - 1 };
      }
      return { rect, partner: pi, door };
    }
    return null;
  }
  // Connect rooms: open the attached-room doorways, then join the remaining separate
  // clusters with 1-wide winding hallways (nearest-first), plus a few extra loops.
  function connectRooms(rooms, attachEdges) {
    if (rooms.length < 2) return;
    const parent = rooms.map((_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (const [ai, bi, door] of (attachEdges || [])) {
      if (inBounds(door.x, door.y) && map[door.y][door.x] === WALL) map[door.y][door.x] = FLOOR;
      union(ai, bi);
    }
    const cen = rooms.map(roomCenter);
    const manh = (a, b) => Math.abs(cen[a].x - cen[b].x) + Math.abs(cen[a].y - cen[b].y);
    const comps = () => new Set(rooms.map((_, i) => find(i))).size;
    let guard = 0;
    while (comps() > 1 && guard++ < 200) {           // join nearest rooms across components
      let best = null;
      for (let a = 0; a < rooms.length; a++) for (let b = a + 1; b < rooms.length; b++) {
        if (find(a) === find(b)) continue;
        const d = manh(a, b);
        if (!best || d < best.d) best = { a, b, d };
      }
      if (!best) break;
      carveCorridor(cen[best.a], cen[best.b]); union(best.a, best.b);
    }
    // A few extra loops for alternate routes.
    for (let a = 0; a < rooms.length; a++) {
      if (Math.random() > 0.4) continue;
      let nb = -1, nd = Infinity;
      for (let b = 0; b < rooms.length; b++) { if (b === a) continue; const d = manh(a, b); if (d < nd) { nd = d; nb = b; } }
      if (nb >= 0) carveCorridor(cen[a], cen[nb]);
    }
  }
  // Breakdown of the finished level: how much is room floor vs corridor floor.
  function computeFill(rooms) {
    const inRoom = blankGrid(false);
    for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) inRoom[y][x] = true;
    let room = 0, corridor = 0;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (inRoom[y][x]) room++;                                    // room footprint (trees/thorns inside still count)
      else if (map[y][x] === FLOOR || map[y][x] === DOOR) corridor++;  // walkable corridor/threshold outside rooms
    }
    const total = MAP_W * MAP_H;
    return {
      total, rooms: rooms.length, roomTiles: room, corridorTiles: corridor, floorTiles: room + corridor,
      roomPct: +(100 * room / total).toFixed(1), corridorPct: +(100 * corridor / total).toFixed(1), floorPct: +(100 * (room + corridor) / total).toFixed(1),
    };
  }
  // Rooms bigger than 20 tiles sprout obstacle trees (wall pillars) — one, plus
  // one more for every 5 tiles of area beyond 20 — placed on interior floor so
  // entrances stay clear. Skips thorn vaults, the player, items and monsters.
  function placeTrees(rooms, restricted) {
    for (let i = 0; i < rooms.length; i++) {
      if (restricted.has(i)) continue;
      const r = rooms[i]; const area = r.w * r.h;
      if (area <= 20) continue;
      const n = 1 + Math.floor((area - 21) / 5);
      const cen = roomCenter(r);
      let placed = 0, guard = 0;
      while (placed < n && guard++ < 60) {
        const x = randInt(r.x + 1, r.x + r.w - 2), y = randInt(r.y + 1, r.y + r.h - 2);
        if (map[y][x] !== FLOOR) continue;
        if (x === cen.x && y === cen.y) continue;                 // keep the corridor target clear
        if (x === player.x && y === player.y) continue;
        if (itemAt(x, y) || monsterAt(x, y)) continue;
        map[y][x] = WALL; placed++;                               // a tree / pillar (rendered per biome)
      }
    }
  }

  const doorWord = () => (biome && biome.door === "bush" ? "bushes" : "door");

  // Bushes/doors at room mouths. With 3-wide entrances we place them sparsely — a
  // single bush per opening, and never two bushes touching (8-neighbour), so a
  // doorway is a lone bush rather than a wall of them.
  function placeDoors(rooms) {
    const cand = [], seen = new Set();
    for (const r of rooms) for (const [x, y] of roomRing(r)) {
      if (!inBounds(x, y) || map[y][x] !== FLOOR) continue;
      const k = y * MAP_W + x; if (seen.has(k)) continue; seen.add(k);
      cand.push([x, y]);
    }
    for (let i = cand.length - 1; i > 0; i--) { const j = randInt(0, i); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
    const placed = [];
    for (const [x, y] of cand) {
      if (placed.some(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) <= 1)) continue;  // no two bushes touching
      map[y][x] = DOOR; placed.push([x, y]);
    }
  }
  // ---- Traps: hidden on the floor, sprung when stepped on, spotted by chance ----
  function pickTrapKey() {
    if (!TRAP_KEYS.length) return null;
    let total = 0; for (const k of TRAP_KEYS) total += (TRAPS[k].weight || 1);
    let r = Math.random() * total;
    for (const k of TRAP_KEYS) { r -= (TRAPS[k].weight || 1); if (r < 0) return k; }
    return TRAP_KEYS[0];
  }
  function placeTraps() {
    if (!TRAP_KEYS.length) return;
    const n = randInt(2, 4) + Math.floor(depth / 3);
    for (let i = 0; i < n; i++) {
      let spot = null;
      for (let t = 0; t < 60; t++) {
        const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
        const c = map[y][x];
        if (c !== FLOOR) continue;                                   // corridors & room floor only
        if (cheb(x, y, player.x, player.y) < 3) continue;            // never right under the player
        if (map[y][x] === STAIRS || itemAt(x, y) || trapAt(x, y)) continue;
        spot = { x, y }; break;
      }
      if (!spot) continue;
      const key = pickTrapKey();
      if (key) traps.push({ x: spot.x, y: spot.y, key, revealed: false, sprung: false });
    }
  }
  // Each turn, a chance to notice hidden traps on adjacent tiles (Luck helps).
  function searchForTraps() {
    // Notice radius = 1 + LCK/5 tiles. Per-turn chance = 10%·(INT/10) + LCK% = INT + LCK (in %).
    const radius = 1 + Math.floor(eff("LCK") / 5);
    const chance = (eff("INT") + eff("LCK")) / 100;
    if (chance <= 0) return;
    for (const t of traps) {
      if (t.revealed || t.sprung) continue;
      if (cheb(t.x, t.y, player.x, player.y) > radius) continue;
      if (!lineOfSight(player.x, player.y, t.x, t.y)) continue;   // must have a clear line to spot it
      if (Math.random() < chance) {
        t.revealed = true;
        floatText(t.x, t.y, "!", "#ffd98a");
        log("You spot a " + (TRAPS[t.key].name || "trap") + " nearby.");
      }
    }
  }
  // Trigger a trap. `remote` is true when it was set off from a distance (a thrown
  // item landing on it) rather than the player stepping on it — location-based
  // traps (arrow, bomb) play out the same, but player-centric ones don't grab the
  // player when they're nowhere near.
  function triggerTrap(t, remote) {
    t.revealed = true;
    const def = TRAPS[t.key] || {};
    if (def.effect === "bomb") {                // arms a fuse instead of firing now
      t.sprung = true; t.armed = 3;             // explodes 3 of the player's turns later
      flash(player); floatText(t.x, t.y, "TICK!", "#e0685a");
      log("A bomb trap clicks to life — it blows in 3 turns. Get clear of the blast!", "hurt");
      return;
    }
    t.sprung = true;
    if (remote) floatText(t.x, t.y, "TRAP!", "#e0685a");
    else { flash(player); floatText(player.x, player.y, "TRAP!", "#e0685a"); }
    log((remote ? "Your throw springs a " : "You trigger a ") + (def.name || "trap") + "!", "hurt");
    if (def.effect === "teleport_far") {
      spawnSpiral(t.x, t.y, "#c79bff", 640);
      if (remote) teleportCreatureAt(t);        // grab whoever's on the rune, not the distant thrower
      else teleportToFurthestMonster();
    }
    else if (def.effect === "arrow") arrowTrap(t);
    else if (!remote) applyEffect(def.effect);  // generic (player-centric) effects only when you step on it
  }
  // A remotely-sprung teleport rune seizes the creature standing on it (a monster
  // → blink it away; the player → the usual yank), else it fizzles.
  function teleportCreatureAt(t) {
    const m = monsterAt(t.x, t.y);
    if (m) {
      for (let i = 0; i < 200; i++) {
        const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
        if (passable(x, y) && map[y][x] !== THORN && !monsterAt(x, y) && !(x === player.x && y === player.y)) {
          spawnBurst(m.x, m.y, "#c79bff"); m.x = x; m.y = y; snapEntity(m);
          spawnBurst(x, y, "#c79bff"); floatText(x, y, "✦", "#e0c6ff");
          break;
        }
      }
      log("The rune seizes the " + monName(m) + " and flings it across the dungeon!");
    } else if (player.x === t.x && player.y === t.y) {
      teleportToFurthestMonster();
    } else {
      log("The rune flares, but finds no one to seize.");
    }
  }
  // Arrow trap: a bolt flies at the nearest mobile character to the trap (usually
  // whoever tripped it, but a closer monster catches it instead). Damage scales
  // with depth: (1..3)×floor, capped at (player level + floor).
  function arrowTrap(t) {
    const floor = depth;
    const dmg = Math.max(1, Math.min(player.level + floor, randInt(1, 3) * floor));
    let tgt = { kind: "player", x: player.x, y: player.y }, td = cheb(t.x, t.y, player.x, player.y);
    for (const m of monsters) {
      if (m.hp <= 0) continue;
      const dd = cheb(t.x, t.y, m.x, m.y);
      if (dd < td) { td = dd; tgt = { kind: "mon", m, x: m.x, y: m.y }; }
    }
    spawnProjectile(t.x, t.y, tgt.x, tgt.y, "#e8d08a");
    spawnStreak(t.x, t.y, tgt.x, tgt.y, "#c9a24a", 240);
    if (tgt.kind === "player") {
      player.hp -= dmg; flash(player); floatText(player.x, player.y, "➶-" + dmg, "#ff8f84");
      log("A hidden arrow strikes you! (-" + dmg + ")", "hurt");
      if (player.hp <= 0) { updateHUD(); die(); return; }
    } else {
      const m = tgt.m; m.hp -= dmg; flash(m); floatText(m.x, m.y, "➶-" + dmg, "#e8d08a");
      log("A hidden arrow skewers the " + monName(m) + "! (-" + dmg + ")");
      if (m.hp <= 0) killMonster(m, "is shot down");
    }
    updateHUD();
  }
  // Tick armed bomb traps once per player action; detonate at zero.
  function tickBombs() {
    for (const t of traps) {
      if (!t.armed || t.armed <= 0) continue;
      if (--t.armed <= 0) explodeBomb(t);
      if (dead) return;
    }
  }
  function explodeBomb(t) {
    const dmg = randInt(8, 15);
    spawnBurst(t.x, t.y, "#ff8f4a"); flashScreen("#7a2e1e", 260);
    for (let yy = t.y - 1; yy <= t.y + 1; yy++) for (let xx = t.x - 1; xx <= t.x + 1; xx++) {
      if (!inBounds(xx, yy)) continue;
      floatText(xx, yy, "✸", "#ffb26a");
      const mm = monsterAt(xx, yy);
      if (mm && mm.hp > 0) { mm.hp -= dmg; flash(mm); floatText(mm.x, mm.y, "-" + dmg, "#ff8f4a"); if (mm.hp <= 0) killMonster(mm, "is blown apart"); }
    }
    if (cheb(t.x, t.y, player.x, player.y) <= 1) {   // player caught in the 3×3
      player.hp -= dmg; flash(player); floatText(player.x, player.y, "-" + dmg, "#ff8f84");
      log("The bomb erupts — you're caught in the blast! (-" + dmg + ")", "hurt");
      if (player.hp <= 0) { updateHUD(); die(); return; }
    } else log("The bomb erupts in a gout of fire.");
    updateHUD();
  }
  // Teleport-trap: fling the player next to the monster that is currently furthest away.
  function teleportToFurthestMonster() {
    const reach = floodReach(player.x, player.y, true);      // never fling you behind thorns
    const live = monsters.filter((m) => m.hp > 0);
    // Consider only foes you could reach on foot — a monster sealed inside a thorn
    // vault is off-limits as a landing, so the trap can't strand you in the brambles.
    let fd = -1, spot = null;
    for (const m of live) {
      const s = nearestFreeFloor(m.x, m.y);
      if (!s || !reach.has(s.y * MAP_W + s.x)) continue;
      const d = cheb(m.x, m.y, player.x, player.y);
      if (d > fd) { fd = d; spot = s; }
    }
    if (!spot) { applyEffect("teleport"); return; }          // no reachable foe → random blink
    spawnBurst(player.x, player.y, "#c79bff");              // implode at the launch point
    player.x = spot.x; player.y = spot.y; computeFOV(); snapPlayer();
    flashScreen("#7a4fb0", 460);                            // teleport whoosh
    spawnBurst(player.x, player.y, "#c79bff");              // materialise at the landing
    floatText(player.x, player.y, "✦", "#e0c6ff");
    log("The trap flings you across the dungeon — a foe looms.", "hurt");
  }
  // BFS out from (tx,ty) for the closest passable, unoccupied floor tile.
  function nearestFreeFloor(tx, ty) {
    const seen = new Set([ty * MAP_W + tx]);
    const q = [[tx, ty]];
    while (q.length) {
      const [x, y] = q.shift();
      if (passable(x, y) && !(x === tx && y === ty && monsterAt(x, y)) && !monsterAt(x, y) && !(x === player.x && y === player.y)) return { x, y };
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx, ny = y + dy, k = ny * MAP_W + nx;
        if (!inBounds(nx, ny) || seen.has(k)) continue;
        seen.add(k);
        if (passable(nx, ny)) q.push([nx, ny]);
      }
    }
    return null;
  }

  // The wall-ring cells of a room (its perimeter), as [x, y] pairs.
  function roomRing(r) {
    const ring = [];
    for (let x = r.x; x < r.x + r.w; x++) { ring.push([x, r.y - 1]); ring.push([x, r.y + r.h]); }
    for (let y = r.y; y < r.y + r.h; y++) { ring.push([r.x - 1, y]); ring.push([r.x + r.w, y]); }
    return ring;
  }
  function roomDoors(r) {
    return roomRing(r).filter(([x, y]) => isDoor(x, y));
  }
  function freeFloorInRoom(r) {
    for (let t = 0; t < 40; t++) {
      const x = randInt(r.x, r.x + r.w - 1), y = randInt(r.y, r.y + r.h - 1);
      if (map[y][x] !== FLOOR) continue;
      if (x === player.x && y === player.y) continue;
      if (itemAt(x, y) || monsterAt(x, y)) continue;
      return { x, y };
    }
    return null;
  }
  // A choice item for a thorn vault: usually a full gear drop, sometimes a
  // permanent Strength potion, else another consumable.
  function rollVaultLoot(floor) {
    const r = Math.random();
    if (r < 0.55) return rollGearDrop(floor);
    if (r < 0.75) return { key: "strength" };   // permanent stat gain — worth the sting
    return { key: weightedConsumKey() };
  }

  // Seal a small side room behind brambles and hide a choice item inside. Returns a
  // Set of restricted room indices (torches are kept out of them).
  // The full 8-neighbour ring of a room — its 4 edges AND its 4 diagonal corners.
  // Sealing all of these is what actually walls a room off: a corner left open
  // lets the player slip in diagonally, so an "entrance" must include corners.
  function roomRing8(r) {
    const ring = [];
    for (let x = r.x - 1; x <= r.x + r.w; x++) { ring.push([x, r.y - 1]); ring.push([x, r.y + r.h]); }
    for (let y = r.y; y < r.y + r.h; y++) { ring.push([r.x - 1, y]); ring.push([r.x + r.w, y]); }
    return ring;
  }
  // Every non-wall cell in that full ring = a way into the room.
  function roomOpenings(r) {
    return roomRing8(r).filter(([x, y]) => inBounds(x, y) && map[y][x] !== WALL);
  }
  // Is any floor tile inside room `r` reachable from the start without a torch?
  function interiorReachableTorchFree(r) {
    const reach = floodReach(player.x, player.y, true);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++)
        if (map[y][x] === FLOOR && reach.has(y * MAP_W + x)) return true;
    return false;
  }
  // Tiles reachable from (sx,sy) by real movement (8-dir + corner rule). When
  // blockThorns is true, brambles count as walls — i.e. reachable WITHOUT a torch.
  function floodReach(sx, sy, blockThorns) {
    const seen = new Set([sy * MAP_W + sx]);
    const q = [[sx, sy]];
    const blocked = (x, y) => !inBounds(x, y) || map[y][x] === WALL || (blockThorns && map[y][x] === THORN);
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx, ny = y + dy, k = ny * MAP_W + nx;
        if (blocked(nx, ny) || seen.has(k)) continue;
        if (dx && dy && blocked(x + dx, y) && blocked(x, y + dy)) continue;   // no diagonal corner-cut
        seen.add(k); q.push([nx, ny]);
      }
    }
    return seen;
  }
  function makeThornVaults(rooms, last) {
    const restricted = new Set();
    let candidates = [];
    for (let i = 1; i < rooms.length; i++) {
      const r = rooms[i];
      if (r === last) continue;
      const openings = roomOpenings(r).length;
      if (openings >= 1 && openings <= 14 && r.w * r.h <= 55) candidates.push({ i, openings });
    }
    candidates.sort((a, b) => a.openings - b.openings);   // fewest entrances = tidiest vaults
    candidates = candidates.map((c) => c.i);
    const nVaults = Math.random() < 0.5 ? 1 : 2;
    for (let v = 0; v < nVaults && candidates.length; v++) {
      // Only seal a room if EVERY other room stays reachable from the start without
      // crossing thorns — so a vault is always optional and can never wall the
      // player in. (Torches sit on non-vault walls, all in that reachable region,
      // so a torch always "precedes" the brambles.)
      let pick = -1;
      while (candidates.length) {
        const cand = candidates.shift();
        const openings = roomOpenings(rooms[cand]);
        const saved = openings.map(([x, y]) => map[y][x]);
        for (const [x, y] of openings) map[y][x] = THORN;                 // tentative seal
        const reach = floodReach(player.x, player.y, true);              // reachable torch-free
        let safe = true;
        // (a) every OTHER room must still be reachable without a torch, so a vault
        //     never walls the player in.
        for (let j = 0; j < rooms.length && safe; j++) {
          if (j === cand) continue;
          const c = roomCenter(rooms[j]);
          if (!reach.has(c.y * MAP_W + c.x)) safe = false;
        }
        // (b) the vault interior must be UNreachable without a torch — thorns are
        //     the only way in. If any interior tile leaks (a corner, a stray
        //     corridor), this seal is no good.
        if (safe && interiorReachableTorchFree(rooms[cand])) safe = false;
        if (safe) { pick = cand; break; }
        openings.forEach(([x, y], o) => { map[y][x] = saved[o]; });      // revert an unsafe seal
      }
      if (pick < 0) break;
      const spot = freeFloorInRoom(rooms[pick]);
      if (spot) items.push(Object.assign({ x: spot.x, y: spot.y, vault: true }, rollVaultLoot(depth)));
      restricted.add(pick);
    }
    return restricted;
  }

  // Mount exactly `count` torches — a strict 1:1 with the thorns on the level, so
  // there's always fuel for every bramble. Each torch sits on a wall touching a
  // torch-free-reachable floor tile, so you can always grab one before any thorn
  // (and never one sealed inside a vault). Room walls are preferred; if those run
  // short we fall back to any qualifying wall so the count is always met.
  function placeTorches(rooms, restricted, count) {
    if (count <= 0) return;
    const reach = floodReach(player.x, player.y, true);
    const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const grabbableWall = (x, y) => {
      if (!inBounds(x, y) || map[y][x] !== WALL) return false;
      for (const [dx, dy] of ORTHO) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && map[ny][nx] === FLOOR && reach.has(ny * MAP_W + nx)) return true;
      }
      return false;
    };
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = randInt(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    // Tier 1: walls around non-vault rooms (tidiest). Tier 2: any qualifying wall.
    const seenSpot = new Set(), roomSpots = [], anySpots = [];
    for (let i = 0; i < rooms.length; i++) {
      if (restricted.has(i)) continue;
      for (const [x, y] of roomRing(rooms[i])) { const k = y * MAP_W + x; if (!seenSpot.has(k) && grabbableWall(x, y)) { seenSpot.add(k); roomSpots.push([x, y]); } }
    }
    const inRoomSpot = new Set(roomSpots.map(([x, y]) => y * MAP_W + x));
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) { const k = y * MAP_W + x; if (!inRoomSpot.has(k) && grabbableWall(x, y)) anySpots.push([x, y]); }
    const order = shuffle(roomSpots).concat(shuffle(anySpots));
    const used = new Set();
    for (const [x, y] of order) {
      if (torches.length >= count) break;
      const k = y * MAP_W + x;
      if (used.has(k)) continue;
      used.add(k);
      torches.push({ x, y });
    }
  }
  const countThorns = () => { let n = 0; for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (map[y][x] === THORN) n++; return n; };
  let lastRooms = [];   // the current floor's room rects (dev/inspection)
  let lastAttach = 0;   // how many of them are attached (doorway, no hallway)

  function generateLevel() {
    map = blankGrid(WALL);
    explored = blankGrid(false);
    beenSeen = blankGrid(false);
    visible = blankGrid(false);
    torches = [];
    walkPath = [];
    monsters = [];
    items = [];
    traps = [];
    turns = 0;

    const rooms = [];
    const attachEdges = [];   // [roomIdx, partnerIdx, doorTile] for attached rooms (doorway, no hall)
    // Keep the TOTAL room area about the same as before — the same chambers spread
    // across a big floor, joined by 1-wide winding hallways (or a shared doorway).
    const roomTarget = 340;
    let roomArea = 0, guard = 0;
    while (roomArea < roomTarget && rooms.length < 16 && guard++ < 900) {
      // Varied aspect ratios (often tall or wide) so rooms don't all read as squares,
      // but kept to the familiar chamber size (~24–60 tiles).
      let w = randInt(5, 9), h = randInt(4, 8);
      if (Math.random() < 0.4) { const t = w; w = h; h = t; }
      if (w * h > 60) continue;
      // A fraction of rooms are "attached": placed flush against another with just
      // a doorway between (no hallway). Kept under ~half so most rooms are still
      // joined by hallways; the rest are separate.
      if (rooms.length && Math.random() < 0.3 && attachEdges.length < rooms.length * 0.5) {
        const res = placeAdjacent(rooms, w, h);
        if (!res) continue;
        carveRoom(res.rect); roomArea += w * h; rooms.push(res.rect);
        attachEdges.push([rooms.length - 1, res.partner, res.door]);
        continue;
      }
      const x = randInt(2, MAP_W - w - 3), y = randInt(2, MAP_H - h - 3);
      const room = { x, y, w, h };
      if (rooms.some((r) => overlaps(r, room, 3))) continue;   // ≥3 apart so a 1-wide hall + walls fit between
      carveRoom(room); roomArea += w * h; rooms.push(room);
    }
    connectRooms(rooms, attachEdges);
    lastRooms = rooms; lastAttach = attachEdges.length;

    biomeIndex = biomeOf(depth);
    biome = DATA.biomes[biomeIndex];

    placeDoors(rooms);

    const start = roomCenter(rooms[0]);
    player.x = start.x;
    player.y = start.y;
    const last = rooms[rooms.length - 1];

    // seal a room or two behind thorns and hide good loot inside; those rooms are
    // "restricted", so torches (below) are kept out of them
    const restricted = makeThornVaults(rooms, last);

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
    placeTrees(rooms, restricted);                     // obstacle trees in the larger rooms
    if (!isBossDepth(depth)) placeTraps();             // hidden traps (never on a boss floor)
    placeTorches(rooms, restricted, countThorns());   // 1 torch per thorn on the level
    genStats = computeFill(rooms);
    computeFOV();
    setDepthLabel();
    floaters = [];
    speeches = [];
    projectiles = [];
    bursts = [];
    streaks = [];
    spirals = [];
    screenFlash = null;
    snapPlayer();
    updateHUD();       // vitals + enemy counter reflect the new floor at once
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
      hp: b.hp, maxHp: b.hp, atkMin: b.atkMin, atkMax: b.atkMax,
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
    let count = randInt(2, 4);
    if (Math.random() < 0.10 * count) count += 1;     // ~+10% loot per floor
    // Drop-type mix (gold / gear / consumable) is data-driven so it's tunable in
    // the editor. Default favours gear so weapons & armor aren't drowned out by potions.
    const dw = (LOOT.dropWeights || { gold: 20, gear: 55, consumable: 25 });
    const dwTotal = Math.max(1, (dw.gold || 0) + (dw.gear || 0) + (dw.consumable || 0));
    for (let i = 0; i < count; i++) {
      const spot = freeFloorSpot(rooms);
      if (!spot) continue;
      let r = Math.random() * dwTotal;
      if ((r -= (dw.gold || 0)) < 0) {
        items.push({ x: spot.x, y: spot.y, key: "gold", amount: randInt(2, 12) + depth * 2 });
      } else if ((r -= (dw.gear || 0)) < 0) {
        items.push(Object.assign({ x: spot.x, y: spot.y }, rollGearDrop(depth)));
      } else {
        items.push({ x: spot.x, y: spot.y, key: weightedConsumKey() });
      }
    }
    // Exactly one Potion of Insight (a skill point) is guaranteed on every floor —
    // it never rolls in the random pool (noDrop), so this is its only source.
    const sp = freeFloorSpot(rooms);
    if (sp) items.push({ x: sp.x, y: sp.y, key: "skill_point" });
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
      const mk = pickMonster(); if (mk) monsters.push(makeMonster(mk, x, y));
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
          beenSeen[my][mx] = true;
        }
        if (blocked) {
          if (blocksSight(mx, my)) { newStart = rSlope; continue; }
          else { blocked = false; start = newStart; }
        } else if (blocksSight(mx, my) && i < FOV_RADIUS) {
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
    beenSeen[player.y][player.x] = true;
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

    // bottom-left vitals: HP is live; MP and Food (hunger) are placeholders at full
    const setBar = (fillId, numId, cur, max) => {
      const f = document.getElementById(fillId), n = document.getElementById(numId);
      if (f) f.style.width = Math.max(0, Math.min(100, (cur / Math.max(1, max)) * 100)) + "%";
      if (n) n.textContent = Math.max(0, cur) + "/" + max;
    };
    setBar("vHp", "vHpNum", player.hp, player.maxHp);
    setBar("vMp", "vMpNum", player.mp != null ? player.mp : 100, player.maxMp != null ? player.maxMp : 100);
    setBar("vHg", "vHgNum", player.food != null ? player.food : 100, 100);

    // enemy counter (SPD-style): how many foes you can currently see
    const en = document.getElementById("enemies");
    if (en) {
      const n = visible.length ? monsters.filter((m) => m.hp > 0 && visible[m.y] && visible[m.y][m.x]).length : 0;
      en.textContent = "☠ " + n;
      en.classList.toggle("active", n > 0);
    }
  }
  function setDepthLabel() {
    const el = document.getElementById("depthLabel");
    if (!el) return;
    const b = DATA.biomes[biomeOf(depth)];
    el.textContent = b.name + "  " + floorInBiome(depth) + "/5" + (isBossDepth(depth) ? "  ⚔" : "");
  }

  // ---- Combat --------------------------------------------------------------
  // Remove a slain monster and award XP (with over-level scaling and boss handling).
  function killMonster(target, verb) {
    if (target.hp > 0 || !monsters.includes(target)) return;
    monsters = monsters.filter((m) => m !== target);
    log("The " + monName(target) + " " + (verb || "dies") + ".", "hit");
    // Regular monsters award XP by their tier: ceil(minFloor / 2) — floor 1–2 = 1,
    // floor 3–4 = 2, floor 5 = 3. Bosses give a larger scaled reward.
    let xp;
    if (target.boss) xp = 15 + Math.round(target.maxHp * 0.4);
    else { const mf = (VERMIN[target.type] && VERMIN[target.type].minFloor) || 1; xp = Math.max(1, Math.ceil(mf / 2)); }
    gainXP(xp);
    if (player.boons && player.boons.has("maelon")) {     // Maelon's Grace: lifesteal on every kill
      const heal = Math.min(player.maxHp - player.hp, 2 + Math.floor(player.level / 5));
      if (heal > 0) { player.hp += heal; floatText(player.x, player.y, "+" + heal, "#8ed69a"); updateHUD(); }
    }
    if (target.boss && !monsters.some((m) => m.boss)) onBossDefeated(target.x, target.y);
  }

  // Fire an item's enchants at a target. `power` is the source's primary number
  // (weapon atk on your strike, armor def when you retaliate). Returns nothing;
  // handles the target's death from burst damage.
  // Apply a damage-over-time stack to a monster. `stack:true` adds a fresh,
  // independent stack (poison); `stack:false` refreshes the single existing one
  // of that tag (burn — only ever one at a time).
  function addDot(m, dot, stack) {
    if (!m.dots) m.dots = [];
    if (stack) { m.dots.push(dot); return; }
    const ex = m.dots.find((d) => d.tag === dot.tag);
    if (ex) Object.assign(ex, dot); else m.dots.push(dot);
  }

  // Fire an item's enchants at a target. `power` is the source's primary number
  // (weapon atk on your strike, armor def when you retaliate). Each enchant is
  // driven by its `effect` block in the data (type + params), so new enchants can
  // be authored in the editor without touching this code.
  function procEnchants(enchants, target, power, incoming) {
    if (!enchants || !enchants.length || target.hp <= 0) return;
    for (const e of enchants) {
      if (target.hp <= 0) break;
      const def = LOOT.enchants[e] || {};
      const proc = (def.proc != null ? def.proc : 1) + guildProcBonus();   // Blessing of the Guild: +level% to fire
      if (Math.random() >= proc) continue;
      const fx = def.effect || {};
      const icon = def.icon || "✦", color = def.color || "#cfe6ff";
      switch (fx.type) {
        case "burn": {                                  // instant burst + a short DOT that stacks only once
          const burst = Math.max(1, Math.ceil(power * (fx.burstMult != null ? fx.burstMult : 0.5)));
          target.hp -= burst; flash(target); floatText(target.x, target.y, "🔥-" + burst, "#ff8f4a");
          addDot(target, { tag: "burn", dmg: Math.max(1, Math.ceil(burst / 2)), rounds: fx.dotTurns || 3, icon: "🔥", color: "#ff8f4a" }, false);
          break;
        }
        case "poison": {                                // small hit now, then 1/turn — and it stacks
          const init = fx.initial != null ? fx.initial : 2;
          target.hp -= init; flash(target); floatText(target.x, target.y, "☠-" + init, "#9ad06a");
          addDot(target, { tag: "poison", dmg: fx.perTurn || 1, rounds: fx.turns || 5, icon: "☠", color: "#9ad06a" }, true);
          break;
        }
        case "shock": {                                 // burst + a scaling stun chance
          const burst = Math.max(1, Math.round(power * (fx.burstMult != null ? fx.burstMult : 1)));
          target.hp -= burst; flash(target); floatText(target.x, target.y, "⚡-" + burst, "#9ad0ff");
          const chance = (burst * (fx.stunPer != null ? fx.stunPer : 0.10)) / Math.max(1, target.level || 1);
          if (Math.random() < chance) { target.stun = (target.stun || 0) + 1; floatText(target.x, target.y, "stun!", "#cfe6ff"); }
          break;
        }
        case "thorns": {                                // reflect a share of the damage you just took
          const base = incoming != null ? incoming : power;
          const dmg = Math.max(1, Math.round(base * (fx.mult != null ? fx.mult : 0.5)));
          target.hp -= dmg; flash(target); floatText(target.x, target.y, icon + "-" + dmg, color);
          break;
        }
        default: break;                                 // "haste" and unknown types do nothing on-hit
      }
    }
    if (target.hp <= 0) killMonster(target, "is destroyed");
  }

  function attack(attacker, target, bonus) {
    bonus = bonus || 0;
    if (attacker === player) {
      bump(player, target.x, target.y);
      const surprise = !target.aware;                 // ambush: it never saw you coming
      target.aware = true;
      if (!surprise && !rollHit(playerAcc(), target.eva != null ? target.eva : MON_EVA)) {
        floatText(target.x, target.y, "miss", "#cfe6b0");
        log("The " + monName(target) + " evades your blow.");
        return;
      }
      let dmg = randInt(weaponDmgMin(), weaponDmgMax()) + strBonus() + player.atkBonus + bonus + passiveMod("dmg");
      if (surprise) dmg = Math.round(dmg * 1.5);       // surprise strikes hit harder
      const crit = Math.random() < critChance();       // 5%+ chance for 200%+ damage
      if (crit) dmg = Math.round(dmg * critMult());
      target.hp -= dmg;
      flash(target);
      floatText(target.x, target.y, (crit ? "CRIT " : "") + (surprise ? "!" : "") + "-" + dmg, crit ? "#ff6a6a" : (surprise ? "#ffd98a" : "#ffe08a"));
      const pre = surprise ? "Surprise! You strike the " : "You strike the ";
      if (player.weapon) gainIdentify(player.weapon, 1);   // learn a weapon by swinging it
      if (target.hp <= 0) {
        killMonster(target, "dies");
      } else {
        log(pre + monName(target) + ". (-" + dmg + ")", "hit");
        // weapon enchants proc on a connecting hit (power = weapon damage)
        if (player.weapon) procEnchants(player.weapon.enchants, target, itemPower(player.weapon));
      }
    } else {
      bump(attacker, player.x, player.y);
      const acc = attacker.acc != null ? attacker.acc : MON_ACC;
      if (!rollHit(acc, playerEva())) {                // player evades (DEX)
        floatText(player.x, player.y, "miss", "#cfe6b0");
        log("You evade the " + monName(attacker) + ".");
        return;
      }
      let dmg = randInt(attacker.atkMin, attacker.atkMax) + bonus;
      dmg = Math.max(1, dmg - armorBlock() - vitResist());
      player.hp -= dmg;
      flash(player);
      floatText(player.x, player.y, "-" + dmg, "#ff8f84");
      updateHUD();
      const verb = bonus > 0 ? " charges you!" : attacker.ranged ? " strikes from afar." : " hits you.";
      log("The " + monName(attacker) + verb + " (-" + dmg + ")", "hurt");
      if (player.hp <= 0) { die(); return; }
      // taking a hit is how you learn your worn defensive gear, and how its
      // enchants (armor, rings, trinket, necklace) lash back at the attacker
      for (const it of wornItems()) {
        if (GEAR[it.key].cat === "weapon") continue;
        gainIdentify(it, 1);
        if (attacker.hp > 0 && it.enchants && it.enchants.length) procEnchants(it.enchants, attacker, itemPower(it), dmg);
      }
    }
  }

  function onBossDefeated(x, y) {
    bossActive = false;
    if (biome.final) { win(); return; }
    map[y][x] = STAIRS;             // the way down opens where the boss fell
    explored[y][x] = true;
    player.statPoints += 3;         // boss reward: 3 points to spend later
    // Bosses are the only source of trinkets — always at least blue.
    const trink = rollTrinket(depth);
    if (trink) {
      const spot = nearestFreeFloor(x, y) || { x, y };
      items.push(Object.assign({ x: spot.x, y: spot.y }, trink));
      floatText(spot.x, spot.y, "✦", "#9ad0ff");
    }
    log("The " + bossName + " falls — the way opens. (+3 stat points" + (trink ? ", a trinket glints nearby" : "") + ")", "hit");
    offerBoons();                   // a god extends a blessing: pick one of three
  }

  // ---- Boons: pick one of three at each boss kill; effects are permanent -------
  function offerBoons() {
    const all = DATA.boons || {};
    const avail = Object.keys(all).filter((k) => !(player.boons && player.boons.has(k)));
    if (!avail.length) return;
    for (let i = avail.length - 1; i > 0; i--) { const j = randInt(0, i); const t = avail[i]; avail[i] = avail[j]; avail[j] = t; }
    const pick = avail.slice(0, 3);
    const wrap = document.getElementById("boonChoices");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const k of pick) {
      const g = all[k];
      const btn = document.createElement("button");
      btn.className = "boon-choice"; btn.type = "button";
      btn.innerHTML = `<span class="b-icon" style="color:${g.color || "#f0c14b"}">${g.icon || "✦"}</span>` +
        `<span class="b-text"><span class="b-name" style="color:${g.color || "#f0c14b"}">${g.name}</span>` +
        `<span class="b-desc">${g.desc || ""}</span></span>`;
      btn.addEventListener("click", () => pickBoon(k));
      wrap.appendChild(btn);
    }
    walkPath = [];                  // don't let a queued walk fire under the modal
    boonPending = true;
    document.getElementById("boons").hidden = false;
  }
  function pickBoon(key) {
    const el = document.getElementById("boons"); if (el) el.hidden = true;
    boonPending = false;
    if (!player.boons) player.boons = new Set();
    player.boons.add(key);
    const g = (DATA.boons || {})[key] || {};
    log("You accept " + (g.name || "a boon") + ".", "hit");
    if (key === "kethara") grantPurpleArmor();
    if (key === "ourn") { player.skills[OURN_KEY] = { rank: 1, cd: 0 }; log("You gain Ourn's Blink — an activated skill (freeze time).", "hit"); }
    updateHUD(); updateHotbar();
    if (charOpen) renderChar();
  }
  // Kethara's Gift: a purple armor of a random tier, straight into your pack.
  function grantPurpleArmor() {
    const armors = GEAR_KEYS.filter((k) => GEAR[k].cat === "armor");
    if (!armors.length) return;
    const it = rollItem(armors[randInt(0, armors.length - 1)], depth, "purple");
    it.identified = true;                          // a gift comes revealed
    if (!invAdd(it)) {
      const spot = dropSpot();
      if (spot) items.push(Object.assign({ x: spot.x, y: spot.y }, it));
    }
    floatText(player.x, player.y, "🛡", "#b491d6");
    log("Kethara conjures " + itemName(it) + " for you.", "hit");
  }
  const guildProcBonus = () => ((player.boons && player.boons.has("guild")) ? player.level / 100 : 0);

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
      const lu = cls.levelUp || {};            // flat per-level set (hp/mp/accuracy/evasion)
      player.lvlHp += lu.hp || 0;
      player.lvlAcc += lu.accuracy || 0;
      player.lvlEva += lu.evasion || 0;
      player.lvlCrit += lu.crit || 0;
      player.lvlCritDmg += lu.critDmg || 0;
      player.maxMp += lu.mp || 0; player.mp = Math.min(player.maxMp, player.mp + (lu.mp || 0));
      const nm = computeMaxHp();
      player.hp = Math.min(nm, player.hp + (nm - player.maxHp));   // heal by the max-HP gain
      player.maxHp = nm;
      const extra = [];
      if (lu.hp) extra.push("+" + lu.hp + " HP"); if (lu.mp) extra.push("+" + lu.mp + " MP");
      if (lu.accuracy) extra.push("+" + lu.accuracy + " acc"); if (lu.evasion) extra.push("+" + lu.evasion + " eva");
      if (lu.crit) extra.push("+" + lu.crit + "% crit"); if (lu.critDmg) extra.push("+" + lu.critDmg + "% crit dmg");
      log("Level " + player.level + "!  +2 " + cls.main + ", +1 " + cls.secondary + ", +1 point" + (extra.length ? " · " + extra.join(", ") : ""), "hit");
      const gains = ["+2 " + cls.main, "+1 " + cls.secondary].concat(extra, ["+1 point"]);
      showBanner("LEVEL " + player.level, gains.join("  ·  "));
      flash(player); floatText(player.x, player.y, "LEVEL UP", "#f6d060");
      threshold = player.level * 8;
    }
    updateHUD();
  }
  // A big centered flash over the board (level ups, milestones).
  let bannerTimer = null;
  function showBanner(title, sub) {
    const el = document.getElementById("banner");
    if (!el) return;
    document.getElementById("bannerT").textContent = title;
    document.getElementById("bannerS").textContent = sub || "";
    el.hidden = true;                                   // restart the CSS animation
    void el.offsetWidth;
    el.hidden = false;
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.hidden = true; }, 1900);
  }

  // ---- Movement / a player action -----------------------------------------
  function canStep(x, y, dx, dy) {
    const nx = x + dx, ny = y + dy;
    if (!passable(nx, ny)) return false;
    // no diagonal squeeze past a corner flanked by walls OR thorns — so a wall of
    // brambles can't be slipped around diagonally without stepping through it
    if (dx !== 0 && dy !== 0) {
      const blockA = isWall(x + dx, y) || isThorn(x + dx, y);
      const blockB = isWall(x, y + dy) || isThorn(x, y + dy);
      if (blockA && blockB) return false;
    }
    return true;
  }

  // Returns true if a turn was spent.
  function playerAct(dx, dy) {
    if (dead || (dx === 0 && dy === 0)) return false;
    const nx = player.x + dx, ny = player.y + dy;

    const mon = monsterAt(nx, ny);
    if (mon) { attack(player, mon); worldTurn(attackCost()); return true; }   // weapon speed (+haste, +Metrognome) → attack cost

    // Ranged weapon (spear/bow): if a foe stands along this direction within reach
    // and line of sight, loose a shot — so arrow-key play fires without a tap.
    const rng = weaponRange();
    if (rng > 1) {
      for (let step = 2; step <= rng; step++) {
        const tx = player.x + dx * step, ty = player.y + dy * step;
        if (!inBounds(tx, ty) || isWall(tx, ty)) break;
        const tgt = monsterAt(tx, ty);
        if (tgt && tgt.hp > 0 && lineOfSight(player.x, player.y, tx, ty)) {
          spawnProjectile(player.x, player.y, tx, ty, "#ffe08a"); attack(player, tgt); worldTurn(attackCost());
          return true;
        }
      }
    }

    if (!canStep(player.x, player.y, dx, dy)) {          // walking into a wall-mounted torch lifts it off
      const torchThere = torches.find((t) => t.x === nx && t.y === ny);
      if (torchThere) { takeTorch(torchThere); return true; }
    }

    if (canStep(player.x, player.y, dx, dy)) {
      player.x = nx; player.y = ny;
      if (map[ny][nx] === THORN) {
        const ti = player.inv.findIndex((i) => i.key === "torch");
        if (ti >= 0) {                             // carrying a torch → burn through, no bleeding
          takeOne(ti);
          const cells = [[player.x, player.y]].concat(adjacentThorns());
          for (const [x, y] of cells) { map[y][x] = FLOOR; floatText(x, y, "🔥", "#f6b845"); }
          log(cells.length === 1 ? "Your torch burns the brambles away." : "Your torch sets the brambles ablaze — " + cells.length + " burn away.", "hit");
        } else {
          const d = randInt(5, 10);
          player.hp -= d; flash(player); floatText(player.x, player.y, "-" + d, "#ff8f84");
          log("The thorns tear at you! (-" + d + ")", "hurt");
          if (player.hp <= 0) { updateHUD(); computeFOV(); die(); return true; }
        }
      }
      computeFOV();
      pickUp();
      const tr = trapAt(player.x, player.y);
      if (tr && !tr.sprung) { triggerTrap(tr); if (dead) return true; }
      if (map[player.y][player.x] === STAIRS) { descend(); return true; }  // fresh level, no world turn
      worldTurn(walkCost());     // Metrognome (walk) → you cover ground faster than your foes
      return true;
    }
    return false;
  }

  const INV_MAX = 25;                          // 5×5 grid of slots
  // Add an item entry to the pack. Consumables stack by key into a single slot;
  // gear takes its own slot. Returns false when the pack is full.
  function invAdd(entry) {
    if (!isGear(entry)) {
      const ex = player.inv.find((e) => !isGear(e) && e.key === entry.key);
      if (ex) { ex.count = (ex.count || 1) + (entry.count || 1); return true; }
    }
    if (player.inv.length >= INV_MAX) return false;
    player.inv.push(entry);
    return true;
  }
  // Remove one unit from the entry at idx; returns a single-unit entry (for drop/throw).
  function takeOne(idx) {
    const e = player.inv[idx]; if (!e) return null;
    if (!isGear(e) && (e.count || 1) > 1) { e.count -= 1; return { key: e.key }; }
    player.inv.splice(idx, 1);
    return isGear(e) ? e : { key: e.key };
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
    // carry the item minus its map position (gear keeps its rolled affixes + id progress)
    const entry = isGear(it) ? stripPos(it) : { key: it.key, count: it.count || 1 };
    if (!invAdd(entry)) { log("Your pack is full."); return; }
    items = items.filter((x) => x !== it);
    log("You pick up the " + itemName(it) + ".");
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
    const boonEl = document.getElementById("boons");
    if (boonEl) boonEl.hidden = true;
    boonPending = false;
    generateLevel();
    log("A new adventurer enters the dungeon.");
  }

  // ---- Monster turns -------------------------------------------------------
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const SENSE = 8;          // how far a monster notices the player (needs line of sight)
  const CHARGE_MAX = 7;
  let turns = 0;
  let boonPending = false;    // a boss-reward boon choice is open — block play until picked

  // Passive regeneration is a per-class "turns to reach full health" number, sped
  // up by Vitality:  effective = regenTurns − VIT × vitRegen.  Healing accrues
  // fractionally each turn (maxHp / effective), so a partial tick carries over and
  // the interval per HP can be non-integer.
  function regenTick() {
    const cls = DATA.classes[player.cls] || {};
    let changed = false, healed = 0;
    // HP: heals to full over regenTurns, sped by Vitality.
    if (player.hp < player.maxHp) {
      const effTurns = Math.max(1, (cls.regenTurns != null ? cls.regenTurns : 600) - eff("VIT") * (cls.vitRegen != null ? cls.vitRegen : 2));
      player.regenAcc = (player.regenAcc || 0) + player.maxHp / effTurns;
      while (player.regenAcc >= 1 && player.hp < player.maxHp) { player.regenAcc -= 1; player.hp++; healed++; }
      if (player.hp >= player.maxHp) player.regenAcc = 0;
      if (healed) changed = true;
    } else player.regenAcc = 0;
    // MP: heals to full over mpRegenTurns, sped by Intelligence.
    if (player.maxMp > 0 && player.mp < player.maxMp) {
      const effMp = Math.max(1, (cls.mpRegenTurns != null ? cls.mpRegenTurns : 600) - eff("INT") * (cls.intRegen != null ? cls.intRegen : 2));
      player.mpRegenAcc = (player.mpRegenAcc || 0) + player.maxMp / effMp;
      while (player.mpRegenAcc >= 1 && player.mp < player.maxMp) { player.mpRegenAcc -= 1; player.mp++; changed = true; }
      if (player.mp >= player.maxMp) player.mpRegenAcc = 0;
    } else player.mpRegenAcc = 0;
    if (healed) floatText(player.x, player.y, "+" + healed, "#8ed69a");
    if (changed) updateHUD();
  }

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
      if (blocksSight(x, y)) return false;
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

  function stepMonsterTo(m, tx, ty) {
    let best = null, bestD = Infinity;
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!canStep(m.x, m.y, dx, dy) || isThorn(nx, ny)) continue;   // monsters won't brave brambles
      if (nx === player.x && ny === player.y) continue;
      if (monsterAt(nx, ny)) continue;
      const d = cheb(nx, ny, tx, ty);
      if (d < bestD) { bestD = d; best = [nx, ny]; }
    }
    if (best) { m.x = best[0]; m.y = best[1]; }
  }
  function patrolStep(m) {
    if (!m.patrol || (m.x === m.patrol.x && m.y === m.patrol.y)) m.patrol = randomFloor();
    if (!m.patrol) return;
    let best = null, bestD = Infinity;
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!canStep(m.x, m.y, dx, dy) || isThorn(nx, ny)) continue;
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
    const sx = m.x, sy = m.y;
    let moved = 0;
    while (cheb(m.x, m.y, player.x, player.y) > 1) {
      const nx = m.x + dir[0], ny = m.y + dir[1];
      if (nx === player.x && ny === player.y) break;
      if (!canStep(m.x, m.y, dir[0], dir[1]) || isThorn(nx, ny) || monsterAt(nx, ny)) break;
      m.x = nx; m.y = ny; moved++;
    }
    if (moved > 0) {                                         // make the dash READ: streak + a slower slide + a roar
      m.moveMs = Math.min(520, 150 + moved * 70);
      spawnStreak(sx, sy, m.x, m.y, "#e8a24a", 300 + moved * 40);
      floatText(sx, sy, "⚡", "#ffcf8a");
    }
    if (cheb(m.x, m.y, player.x, player.y) === 1) {
      attack(m, player, moved);                             // +1 dmg per tile crossed
      spawnBurst(player.x, player.y, "#e8a24a");            // slam impact at the player
      if (moved >= 2) flashScreen("#5a3a1e", 200);
    }
  }
  // A charge monster (bear) that can see you but isn't lined up sidesteps to get on
  // your row / column / diagonal (at range) so it can charge, instead of just
  // trudging straight in and settling for a normal swing.
  function chargeApproach(m) {
    let best = null, bestScore = -Infinity;
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!canStep(m.x, m.y, dx, dy) || isThorn(nx, ny) || monsterAt(nx, ny)) continue;
      if (nx === player.x && ny === player.y) continue;
      const ddx = player.x - nx, ddy = player.y - ny;
      const dist = Math.max(Math.abs(ddx), Math.abs(ddy));
      const aligned = (ddx === 0 || ddy === 0 || Math.abs(ddx) === Math.abs(ddy));
      let score = -dist;                                    // closing in is good
      if (aligned && dist >= 2 && dist <= CHARGE_MAX && lineOfSight(nx, ny, player.x, player.y)) score += 100;  // a charge lane = great
      if (score > bestScore) { bestScore = score; best = [nx, ny]; }
    }
    if (best) { m.x = best[0]; m.y = best[1]; }
    else stepMonsterTo(m, player.x, player.y);
  }

  function eligiblePool() {
    const f = floorInBiome(depth);
    // minFloor doubles as the on/off switch: no minFloor = disabled; a number =
    // enabled, and the earliest biome-floor (1..5) it may appear on.
    return biome.monsters.filter((k) => VERMIN[k].minFloor != null && VERMIN[k].minFloor <= f);
  }
  // Weighted pick among the eligible monsters for the current biome-floor. Weights
  // come from biome.spawnMix[key][floor-1] (default 1 when unset); a 0 bars that
  // monster on that floor. Falls back to uniform if every weight is 0.
  function pickMonster() {
    const pool = eligiblePool();
    if (!pool.length) return null;
    const fi = floorInBiome(depth) - 1;
    const mix = biome.spawnMix || {};
    let total = 0;
    // Spawn mix values are per-floor spawn percentages: a blank means 0% (that
    // monster isn't in this floor's mix). If a floor has no percentages at all,
    // fall back to an even spread across everything eligible.
    const weights = pool.map((k) => {
      const raw = mix[k] && mix[k][fi] != null ? Number(mix[k][fi]) : 0;
      const w = raw > 0 ? raw : 0; total += w; return w;
    });
    if (total <= 0) return pool[randInt(0, pool.length - 1)];
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r < 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  function spawnOne() {
    const pool = eligiblePool();
    if (!pool.length) return;
    for (let t = 0; t < 40; t++) {
      const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
      if (map[y][x] !== FLOOR || visible[y][x] || monsterAt(x, y)) continue;
      if (cheb(x, y, player.x, player.y) < 6) continue;    // arrive out of sight, at a distance
      const mk = pickMonster(); if (mk) monsters.push(makeMonster(mk, x, y));
      return;
    }
  }
  function maybeReinforce() {
    if (bossActive) return;
    const every = biome.spawnEvery || 0;
    const cap = biome.spawnCap || 12;
    if (every > 0 && turns % every === 0 && monsters.length < cap) spawnOne();
  }

  // One monster action (its burn tick, stun, and AI move/attack). Returns after
  // acting; the caller checks `dead`.
  // Drop `count` monsters of `type` on free floor within `radius` tiles of (cx,cy).
  function spawnNear(type, cx, cy, radius, count) {
    let placed = 0;
    for (let t = 0; t < 240 && placed < count; t++) {
      const gx = cx + randInt(-radius, radius), gy = cy + randInt(-radius, radius);
      if (!inBounds(gx, gy) || map[gy][gx] === WALL || map[gy][gx] === THORN) continue;
      if (cheb(gx, gy, cx, cy) > radius) continue;
      if (monsterAt(gx, gy) || (gx === player.x && gy === player.y)) continue;
      const mm = makeMonster(type, gx, gy); mm.aware = true;
      monsters.push(mm); placed++;
    }
    return placed;
  }
  function snapEntity(m) { m.rx = m.x; m.ry = m.y; m.lx = m.x; m.ly = m.y; m.ax = m.x; m.ay = m.y; m.at = 0; }

  // ---- The Pied Piper (forest boss) ---------------------------------------
  function piperAct(m) {
    if (m.beam) { piperFireBeam(m); return; }        // fire the line telegraphed last turn
    const see = canSee(m);
    if (see) { m.aware = true; m.lastSeen = { x: player.x, y: player.y }; }
    // Entrance: the first time it sees you, it calls vermin to your side.
    if (see && !m.summoned) {
      m.summoned = true;
      spawnNear("rat", player.x, player.y, 3, 2);
      spawnNear("snake", player.x, player.y, 3, 1);
      flashScreen("#7a1e1e", 320);
      sayMonster(m, "Friends, friends everywhere", "#e07aa0");
      log("The Piper's shrill tune summons vermin around you!", "hurt");
      return;
    }
    // Halfway: vanish (up to 10 tiles) and leave a brood behind.
    if (!m.phased && m.hp <= m.maxHp * 0.5) { m.phased = true; piperPhaseShift(m); return; }
    const d = cheb(m.x, m.y, player.x, player.y);
    // Signature attack: telegraph a straight line, then send an exploding rat down it.
    if ((m.beamCd | 0) <= 0 && see && d >= 2 && lineOfSight(m.x, m.y, player.x, player.y)) {
      piperCastBeam(m); m.beamCd = 7; return;
    }
    if (m.beamCd > 0) m.beamCd--;
    if (d === 1) { attack(m, player); return; }
    if (see) { stepMonsterTo(m, player.x, player.y); return; }
    if (m.lastSeen) { stepMonsterTo(m, m.lastSeen.x, m.lastSeen.y); if (m.x === m.lastSeen.x && m.y === m.lastSeen.y) m.lastSeen = null; return; }
    patrolStep(m);
  }
  function piperPhaseShift(m) {
    const ox = m.x, oy = m.y;
    let best = null, bestScore = -1;
    for (let t = 0; t < 300; t++) {
      const x = m.x + randInt(-10, 10), y = m.y + randInt(-10, 10);
      if (!inBounds(x, y) || map[y][x] === WALL || map[y][x] === THORN) continue;
      const dd = cheb(x, y, m.x, m.y);
      if (dd < 3 || dd > 10) continue;
      if (monsterAt(x, y) || (x === player.x && y === player.y)) continue;
      const score = cheb(x, y, player.x, player.y);   // prefer landing far from the player
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    spawnBurst(ox, oy, "#c79bff");
    if (best) { m.x = best.x; m.y = best.y; snapEntity(m); }
    spawnBurst(m.x, m.y, "#c79bff"); flashScreen("#7a4fb0", 380);
    spawnNear("rat", ox, oy, 2, 3);
    spawnNear("snake", ox, oy, 2, 2);
    m.aware = true; m.lastSeen = { x: player.x, y: player.y };
    log("The Piper vanishes in a swirl, leaving its brood behind!", "hurt");
  }
  // Build a straight line through the player's tile (wall to wall) and mark it red.
  function piperCastBeam(m) {
    const dx = player.x - m.x, dy = player.y - m.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    let dir;
    if (adx === 0 && ady === 0) dir = [1, 0];
    else if (adx >= 2 * ady) dir = [Math.sign(dx), 0];
    else if (ady >= 2 * adx) dir = [0, Math.sign(dy)];
    else dir = [Math.sign(dx) || 1, Math.sign(dy) || 1];
    const pass = (x, y) => inBounds(x, y) && map[y][x] !== WALL;
    let sx = player.x, sy = player.y;                 // back up to the piper-side wall
    while (pass(sx - dir[0], sy - dir[1])) { sx -= dir[0]; sy -= dir[1]; }
    const tiles = [];
    for (let x = sx, y = sy; pass(x, y); x += dir[0], y += dir[1]) tiles.push([x, y]);
    m.beam = { dir, tiles };
    flashScreen("#c02020", 300);                      // a sharp red pulse — impossible to miss
    floatText(player.x, player.y, "⚠", "#ff5a5a");
    sayMonster(m, "Dance for me", "#ff6a6a");
    log("The Piper marks a line of death — MOVE off it!", "hurt");
  }
  function piperFireBeam(m) {
    const line = m.beam.tiles; m.beam = null;         // the red line clears as the rat launches
    const start = line[0];
    let hitIdx = -1;
    for (let i = 0; i < line.length; i++) if (line[i][0] === player.x && line[i][1] === player.y) { hitIdx = i; break; }
    const end = line[hitIdx >= 0 ? hitIdx : line.length - 1];
    spawnProjectile(start[0], start[1], end[0], end[1], "#e0685a");
    spawnBurst(end[0], end[1], "#ff6a4a");
    if (hitIdx >= 0) {
      const dmg = 30;
      player.hp -= dmg; flash(player); floatText(player.x, player.y, "-" + dmg, "#ff5a5a");
      log("The exploding rat slams into you! (-" + dmg + ")", "hurt");
      updateHUD();
      if (player.hp <= 0) { die(); return; }
    } else {
      spawnNear("rat", end[0], end[1], 1, 2);         // bursts on the wall, two rats spill out
      log("You dodge! The rat bursts on the wall — two more scurry out.", "hit");
    }
  }

  function monsterAct(m) {
    if (m.hp <= 0) return;
    if (m.dots && m.dots.length) {              // burn/poison ticks at the start of its action
      for (const dot of m.dots.slice()) {
        m.hp -= dot.dmg; flash(m); floatText(m.x, m.y, dot.icon + "-" + dot.dmg, dot.color);
        if (--dot.rounds <= 0) m.dots = m.dots.filter((x) => x !== dot);
        if (m.hp <= 0) { killMonster(m, dot.tag === "poison" ? "succumbs to poison" : "burns away"); return; }
      }
    }
    if (m.stun && m.stun > 0) { m.stun--; floatText(m.x, m.y, "zzz", "#cfe6ff"); return; }  // stunned: skip
    if (m.type === "piper") { piperAct(m); return; }             // the Pied Piper has its own playbook
    if (canSee(m)) { m.aware = true; m.lastSeen = { x: player.x, y: player.y }; }  // spotted: remember where
    else m.aware = false;                        // lost sight → it forgets you; re-emerging lets you strike first (dance around a tree/bush)
    const d = cheb(m.x, m.y, player.x, player.y);
    if (d === 1) { attack(m, player); return; }
    if (m.ranged && d <= (m.range || 4) && lineOfSight(m.x, m.y, player.x, player.y)) { spawnProjectile(m.x, m.y, player.x, player.y, m.color || "#e0d0a0"); attack(m, player); return; }
    if (m.charge && d >= 2 && d <= CHARGE_MAX && straightDir(m) && lineOfSight(m.x, m.y, player.x, player.y)) { doCharge(m); return; }
    if (canSee(m)) { if (m.charge) chargeApproach(m); else stepMonsterTo(m, player.x, player.y); return; }   // in sight → close in (chargers line up)
    if (m.lastSeen) {                            // lost sight → head to where you were last seen
      stepMonsterTo(m, m.lastSeen.x, m.lastSeen.y);
      if (m.x === m.lastSeen.x && m.y === m.lastSeen.y) m.lastSeen = null;   // reached it, trail goes cold
      return;
    }
    patrolStep(m);                               // no lead → wander
  }

  // Accrue identify-progress on one equipped item through *use* (a weapon when you
  // strike, worn gear when you're hit) — not from idly walking. Reveal once reached.
  function gainIdentify(it, amount) {
    if (!it || it.identified) return;
    it.idXp = (it.idXp || 0) + (amount || 1);
    if (it.idXp >= (it.idNeed || 1)) {
      it.identified = true;
      const aff = itemAffixText(it);
      log("You've learned your " + itemName(it) + (aff && aff !== "unidentified" ? " — " + aff : "") + ".", "hit");
    }
  }

  // Advance the world by `cost` time units (a normal action = 1). Each monster
  // banks energy at its own speed and acts once per whole point — so against a
  // fast weapon (cost < 1) monsters act less often, and a slow one (cost > 1)
  // lets them act more than once. Housekeeping (cooldowns, regen, spawns) ticks
  // once per player action regardless.
  function worldTurn(cost) {
    cost = cost == null ? 1 : cost;
    turns++;
    for (const k in player.skills) if (player.skills[k].cd > 0) player.skills[k].cd--;
    if (player.stoneSkin && player.stoneSkin.turns > 0 && --player.stoneSkin.turns <= 0) {
      player.stoneSkin = null; log("Your stone skin crumbles away.");
    }
    tickBombs(); if (dead) return;              // armed bomb traps count down and detonate
    panX = 0; panY = 0; enemyFocusIdx = -1; pendingThrow = null;   // any action recenters the camera on you
    for (const m of monsters.slice()) {
      if (m.hp <= 0) continue;
      m.energy = (m.energy || 0) + (m.speed || 1) * cost;
      while (m.energy >= 1 && m.hp > 0 && !dead) {
        m.energy -= 1;
        monsterAct(m);
      }
      if (dead) return;
    }
    regenTick();
    searchForTraps();
    maybeReinforce();
    updateHotbar();
    updateHUD();      // refresh vitals + enemy-in-sight counter every turn
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
        if (!canStep(cx, cy, dx, dy) || isThorn(nx, ny)) continue;  // never auto-walk through thorns
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

  let pendingTorch = null;   // a torch we're auto-walking toward, to lift on arrival
  // The nearest walkable, explored floor tile beside (tx,ty).
  function adjacentReachableFloor(tx, ty) {
    let best = null, bd = Infinity;
    for (const [dx, dy] of DIRS8) {
      const x = tx + dx, y = ty + dy;
      if (!inBounds(x, y) || !passable(x, y) || !explored[y][x]) continue;
      const d = cheb(player.x, player.y, x, y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best;
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
    if (examineMode) { describeTile(tx, ty); toggleExamine(false); updateHotbar(); return; }
    if (pendingThrow != null) { const idx = pendingThrow; executeThrow(idx, tx, ty); return; }
    if (pendingSkill && skillDef(pendingSkill) && skillDef(pendingSkill).kind === "rush") {
      const dir = [Math.sign(tx - player.x), Math.sign(ty - player.y)];
      if (dir[0] || dir[1]) executeRush(pendingSkill, dir); else { pendingSkill = null; updateHotbar(); }
      return;
    }
    if (walkPath.length) { walkPath = []; return; }           // tap while travelling = stop
    if (!inBounds(tx, ty)) return;
    const adjacent = cheb(player.x, player.y, tx, ty) === 1;
    // tap a wall torch to take it — if it's not adjacent, walk to a tile beside it
    // and lift it automatically on arrival (torches sit on wall tiles, so we can't
    // path onto the torch itself).
    const torchHere = torches.find((t) => t.x === tx && t.y === ty);
    if (torchHere) {
      if (adjacent) { takeTorch(torchHere); return; }
      const spot = adjacentReachableFloor(tx, ty);
      if (spot) {
        const path = findPath(player.x, player.y, spot.x, spot.y);
        if (path.length) { walkPath = path; pendingTorch = torchHere; return; }
      }
      return;
    }
    // tap an adjacent thorn while carrying a torch → burn it clear instead of bleeding through
    if (adjacent && isThorn(tx, ty)) {
      const ti = player.inv.findIndex((i) => i.key === "torch");
      if (ti >= 0) { useConsumable(ti); return; }
    }
    // ranged weapon (spear/bow): tap a monster within reach + line of sight to fire
    const reach = weaponRange();
    if (reach > 1 && !adjacent) {
      const tgt = monsterAt(tx, ty);
      if (tgt && tgt.hp > 0 && cheb(player.x, player.y, tx, ty) <= reach && lineOfSight(player.x, player.y, tx, ty)) {
        spawnProjectile(player.x, player.y, tx, ty, "#ffe08a"); attack(player, tgt); worldTurn(attackCost()); return;
      }
    }
    if (anyMonsterVisible()) { stepToward(tx, ty); return; }   // stay in control near danger
    const path = findPath(player.x, player.y, tx, ty);
    if (path.length) { walkPath = path; return; }
    // no route (e.g. blocked by thorns): if the tap is an adjacent tile, step in
    // manually — this is how you deliberately push through brambles to the loot
    if (adjacent) stepToward(tx, ty);
  }
  function takeTorch(t) {
    if (!invAdd({ key: "torch" })) { log("Your pack is full."); return; }
    torches = torches.filter((x) => x !== t);
    log("You lift the torch from its bracket.");
    updateHUD();
    worldTurn();
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
  let panX = 0, panY = 0;                 // free-look camera offset (tiles); reset on any action
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
    // player-centred, plus the free-look pan offset (swipe to survey the level)
    camX = clamp(rx - (viewCols - 1) / 2 + panX, MAP_W - viewCols);
    camY = clamp(ry - (viewRows - 1) / 2 + panY, MAP_H - viewRows);
  }
  // Pan the free-look camera by a screen-pixel delta. Inverted: the camera moves in
  // the direction you swipe (like nudging a joystick), not the map under your finger.
  function panBy(dxPx, dyPx) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    panX += dxPx / (rect.width / viewCols);
    panY += dyPx / (rect.height / viewRows);
    panX = Math.max(-MAP_W, Math.min(MAP_W, panX));
    panY = Math.max(-MAP_H, Math.min(MAP_H, panY));
  }

  // ---- Monster-sighting tool (tap the ☠ counter) ---------------------------
  // Cycle the view through every foe currently in line of sight, snapping the
  // camera to centre on each in turn — like Shattered Pixel Dungeon's mob indicator.
  let enemyFocusIdx = -1;
  function visibleEnemies() {
    return monsters
      .filter((m) => m.hp > 0 && visible[m.y] && visible[m.y][m.x])
      .sort((a, b) => cheb(a.x, a.y, player.x, player.y) - cheb(b.x, b.y, player.x, player.y));
  }
  function cycleEnemyFocus() {
    if (dead || mapOpen || invOpen || charOpen || boonPending) return;
    const list = visibleEnemies();
    if (!list.length) { enemyFocusIdx = -1; log("No enemies in sight."); return; }
    enemyFocusIdx = (enemyFocusIdx + 1) % list.length;
    const m = list[enemyFocusIdx];
    panX = m.x - player.x;                 // centre the free-look camera on this foe
    panY = m.y - player.y;
    flash(m); floatText(m.x, m.y, "◎", "#ffd98a");
    log("Foe " + (enemyFocusIdx + 1) + "/" + list.length + ": " + monName(m) + " — Lv " + (m.level || 1) + ", HP " + Math.max(0, m.hp) + "/" + m.maxHp);
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
  // Build a rounded-rect path on ctx (caller then fills/strokes).
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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
  // Doors are drawn procedurally (no sprite dependency). Forest biomes render a
  // leafy bush that thins once pushed through; other biomes get a plank/stone
  // panel with a seam that splits open.
  function drawDoor(px, py, closed, b) {
    const cx = px + tile / 2, cy = py + tile / 2;
    if (biome && biome.door === "bush") {
      const blobs = closed
        ? [[0.30, 0.42, 0.30], [0.66, 0.40, 0.30], [0.48, 0.66, 0.34], [0.48, 0.30, 0.26]]
        : [[0.24, 0.30, 0.18], [0.78, 0.32, 0.17], [0.22, 0.76, 0.17], [0.80, 0.74, 0.18]];
      for (const [fx, fy, fr] of blobs) {
        ctx.beginPath();
        ctx.arc(px + fx * tile, py + fy * tile, tile * fr, 0, Math.PI * 2);
        ctx.fillStyle = shade(fy < 0.5 ? "#3f7a3a" : "#2f5f30", b);
        ctx.fill();
      }
      // ripe berries dotted through the foliage (fewer once trampled open)
      const berries = closed
        ? [[0.34, 0.40], [0.62, 0.52], [0.50, 0.30], [0.44, 0.62], [0.70, 0.36]]
        : [[0.30, 0.36], [0.72, 0.66]];
      const br = Math.max(1.2, tile * 0.055);
      for (const [fx, fy] of berries) {
        ctx.beginPath();
        ctx.arc(px + fx * tile, py + fy * tile, br, 0, Math.PI * 2);
        ctx.fillStyle = shade("#c53a4a", b);
        ctx.fill();
      }
      return;
    }
    if (closed) {
      const m = tile * 0.14;
      ctx.fillStyle = shade("#6b4a28", b);
      ctx.fillRect(px + m, py + m * 0.4, tile - 2 * m, tile - m * 0.8);
      ctx.strokeStyle = shade("#3c2814", b);
      ctx.lineWidth = Math.max(1, tile * 0.05);
      ctx.beginPath(); ctx.moveTo(cx, py + m * 0.4); ctx.lineTo(cx, py + tile - m * 0.4); ctx.stroke();
      ctx.fillStyle = shade("#d8b04a", b);
      ctx.beginPath(); ctx.arc(cx - tile * 0.1, cy, tile * 0.05, 0, Math.PI * 2); ctx.fill();
    } else {
      // opened: two thin jambs at the sides, passage clear
      const w = tile * 0.12;
      ctx.fillStyle = shade("#5a3d22", b);
      ctx.fillRect(px, py, w, tile);
      ctx.fillRect(px + tile - w, py, w, tile);
    }
  }
  // A bramble barrier: a dark tangle with pale spikes jabbing outward. Passable,
  // but stepping through it hurts — it walls off the loot vault.
  function drawThorn(px, py, b) {
    const cx = px + tile / 2, cy = py + tile / 2;
    ctx.fillStyle = shade("#243418", b);
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.40, 0, Math.PI * 2);
    ctx.fill();
    const spikes = 9;
    ctx.strokeStyle = shade("#b9c48a", b);
    ctx.lineWidth = Math.max(1, tile * 0.045);
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + (px + py) * 0.01;   // jitter per tile
      const r0 = tile * 0.14, r1 = tile * 0.44;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    // a couple of red berries caught in the thorns — a hint of what waits beyond
    ctx.fillStyle = shade("#c53a4a", b);
    ctx.beginPath(); ctx.arc(cx - tile * 0.12, cy + tile * 0.08, Math.max(1.2, tile * 0.05), 0, Math.PI * 2); ctx.fill();
  }
  // Wall-mounted torch: a bracket and a flickering flame, with a soft glow pool.
  function drawTorch(px, py, b, now) {
    const cx = px + tile / 2;
    const flick = 1 + Math.sin(now / 120 + (px + py)) * 0.12;
    // glow pool
    const g = ctx.createRadialGradient(cx, py + tile * 0.42, tile * 0.1, cx, py + tile * 0.42, tile * 0.9);
    g.addColorStop(0, "rgba(246,184,69," + (0.30 * b).toFixed(3) + ")");
    g.addColorStop(1, "rgba(246,184,69,0)");
    ctx.fillStyle = g;
    ctx.fillRect(px - tile * 0.4, py - tile * 0.4, tile * 1.8, tile * 1.8);
    // bracket
    ctx.strokeStyle = shade("#3c2c18", b);
    ctx.lineWidth = Math.max(1, tile * 0.06);
    ctx.beginPath(); ctx.moveTo(cx, py + tile * 0.72); ctx.lineTo(cx, py + tile * 0.42); ctx.stroke();
    // flame
    ctx.beginPath();
    ctx.moveTo(cx, py + tile * (0.16 * flick));
    ctx.quadraticCurveTo(cx + tile * 0.16, py + tile * 0.34, cx, py + tile * 0.46);
    ctx.quadraticCurveTo(cx - tile * 0.16, py + tile * 0.34, cx, py + tile * (0.16 * flick));
    ctx.fillStyle = shade("#f6b845", b);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, py + tile * 0.36, tile * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = shade("#ffe08a", b);
    ctx.fill();
  }
  // A discovered trap: a dark plate + a coloured ring so it reads at a glance, with
  // a distinct icon per type — a live spiral (teleport), an arrow, or a bomb whose
  // fuse shows its countdown while armed.
  function drawTrapMark(t, px, py, now) {
    const def = TRAPS[t.key] || {};
    const cx = px + tile / 2, cy = py + tile / 2;
    const spent = t.sprung && !t.armed;
    const col = spent ? "#6a5a72" : (def.color || "#b491d6");
    ctx.fillStyle = "rgba(10,7,4,0.55)";
    ctx.beginPath(); ctx.arc(cx, cy, tile * 0.40, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, tile * 0.06); ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy, tile * 0.40, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col;
    const eff = def.effect;
    if (eff === "teleport_far") {
      ctx.beginPath();
      const steps = 40, turns = 2.2, maxR = tile * 0.26, spin = spent ? 0 : now / 500;
      for (let i = 0; i <= steps; i++) { const p = i / steps, a = p * turns * Math.PI * 2 + spin, r = maxR * p; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    } else if (eff === "arrow") {
      ctx.beginPath(); ctx.moveTo(cx - tile * 0.22, cy + tile * 0.18); ctx.lineTo(cx + tile * 0.18, cy - tile * 0.18); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + tile * 0.24, cy - tile * 0.24); ctx.lineTo(cx + tile * 0.24, cy - tile * 0.02); ctx.lineTo(cx + tile * 0.02, cy - tile * 0.24); ctx.closePath(); ctx.fill();
    } else if (eff === "bomb") {
      ctx.beginPath(); ctx.arc(cx, cy + tile * 0.05, tile * 0.20, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + tile * 0.13, cy - tile * 0.12); ctx.quadraticCurveTo(cx + tile * 0.27, cy - tile * 0.24, cx + tile * 0.20, cy - tile * 0.32); ctx.stroke();
      if (t.armed > 0) { ctx.fillStyle = "#fff2c0"; ctx.font = `bold ${Math.floor(tile * 0.4)}px ${bodyFont()}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(t.armed), cx, cy + tile * 0.05); }
    } else {
      ctx.font = `bold ${Math.floor(tile * 0.5)}px ${bodyFont()}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.glyph || "^", cx, cy);
    }
  }
  // ---- Item icons: one set of vector primitives, drawn identically on the
  // floor (ctx, full tile) and in the inventory grid (a small per-slot canvas),
  // so a pickup and its pack icon always match. All take (c, ox, oy, s, …).
  function drawJewelInto(c, ox, oy, s, cat, color) {
    const cx = ox + s / 2, cy = oy + s / 2;
    c.lineWidth = Math.max(1, s * 0.08);
    if (cat === "ring") {
      c.strokeStyle = color; c.beginPath(); c.arc(cx, cy + s * 0.05, s * 0.2, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#bfe0ff"; c.beginPath(); c.arc(cx, cy - s * 0.18, s * 0.08, 0, Math.PI * 2); c.fill();
    } else if (cat === "necklace") {
      c.strokeStyle = color; c.beginPath(); c.arc(cx, cy - s * 0.02, s * 0.22, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      c.fillStyle = color; c.beginPath(); c.arc(cx, cy + s * 0.22, s * 0.09, 0, Math.PI * 2); c.fill();
    } else {   // trinket: a small gem
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(cx, cy - s * 0.22); c.lineTo(cx + s * 0.2, cy); c.lineTo(cx, cy + s * 0.22); c.lineTo(cx - s * 0.2, cy);
      c.closePath(); c.fill();
    }
  }
  // A stoppered flask tinted to the potion's (possibly scrambled) colour.
  function drawFlaskInto(c, ox, oy, s, color) {
    const cx = ox + s / 2;
    c.fillStyle = "#cbb78a";                                   // cork
    c.fillRect(cx - s * 0.06, oy + s * 0.12, s * 0.12, s * 0.12);
    c.fillStyle = "rgba(228,233,238,0.85)";                    // glass neck
    c.fillRect(cx - s * 0.09, oy + s * 0.22, s * 0.18, s * 0.12);
    c.beginPath();                                             // rounded body of liquid
    c.arc(cx, oy + s * 0.58, s * 0.24, 0, Math.PI * 2);
    c.fillStyle = color; c.fill();
    c.strokeStyle = "rgba(255,255,255,0.30)"; c.lineWidth = Math.max(1, s * 0.03); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.4)";                     // highlight
    c.beginPath(); c.arc(cx - s * 0.08, oy + s * 0.50, s * 0.05, 0, Math.PI * 2); c.fill();
  }
  // Simple weapon silhouettes by subtype, for gear with no sprite file.
  function drawWeaponInto(c, ox, oy, s, sub, color) {
    const cx = ox + s / 2, cy = oy + s / 2;
    c.strokeStyle = color; c.fillStyle = color;
    c.lineWidth = Math.max(1.5, s * 0.09); c.lineCap = "round";
    if (sub === "bow") {
      c.beginPath(); c.arc(cx + s * 0.06, cy, s * 0.30, -0.62 * Math.PI, 0.62 * Math.PI); c.stroke();
      c.lineWidth = Math.max(1, s * 0.03);
      c.beginPath();
      c.moveTo(cx + s * 0.06 + Math.cos(-0.62 * Math.PI) * s * 0.30, cy + Math.sin(-0.62 * Math.PI) * s * 0.30);
      c.lineTo(cx + s * 0.06 + Math.cos(0.62 * Math.PI) * s * 0.30, cy + Math.sin(0.62 * Math.PI) * s * 0.30);
      c.stroke();
    } else if (sub === "spear") {
      c.beginPath(); c.moveTo(ox + s * 0.22, oy + s * 0.78); c.lineTo(ox + s * 0.74, oy + s * 0.26); c.stroke();
      c.beginPath(); c.moveTo(ox + s * 0.74, oy + s * 0.16); c.lineTo(ox + s * 0.86, oy + s * 0.30); c.lineTo(ox + s * 0.66, oy + s * 0.34); c.closePath(); c.fill();
    } else {   // dagger / sword / axe fallback: a blade with a crossguard
      c.beginPath(); c.moveTo(ox + s * 0.28, oy + s * 0.76); c.lineTo(ox + s * 0.70, oy + s * 0.24); c.stroke();
      c.lineWidth = Math.max(1.5, s * 0.10);
      c.beginPath(); c.moveTo(ox + s * 0.24, oy + s * 0.62); c.lineTo(ox + s * 0.42, oy + s * 0.80); c.stroke();
    }
  }
  // A rounded cuirass silhouette for armor with no sprite file.
  function drawArmorInto(c, ox, oy, s, color) {
    const cx = ox + s / 2;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(cx - s * 0.22, oy + s * 0.26);
    c.lineTo(cx + s * 0.22, oy + s * 0.26);
    c.lineTo(cx + s * 0.26, oy + s * 0.44);
    c.quadraticCurveTo(cx + s * 0.22, oy + s * 0.78, cx, oy + s * 0.82);
    c.quadraticCurveTo(cx - s * 0.22, oy + s * 0.78, cx - s * 0.26, oy + s * 0.44);
    c.closePath(); c.fill();
    c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = Math.max(1, s * 0.03);
    c.beginPath(); c.moveTo(cx, oy + s * 0.28); c.lineTo(cx, oy + s * 0.80); c.stroke();
  }
  function drawGlyphInto(c, ox, oy, s, ch, color) {
    c.fillStyle = color || "#e6e0d2";
    c.font = "700 " + Math.round(s * 0.7) + "px " + bodyFont();
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(ch || "?", ox + s / 2, oy + s / 2);
  }
  // The one entry point: paint entry `e` (a floor item or a pack entry) into c.
  function renderIconInto(c, ox, oy, s, e) {
    const key = e.key;
    if (key === "gold") { drawGlyphInto(c, ox, oy, s, "¢", "#f0c14b"); return; }
    const d = defOf(key);
    if (!d) { drawGlyphInto(c, ox, oy, s, "?", "#cfc3a0"); return; }
    if (d.cat === "weapon" || d.cat === "armor") {
      const img = SPRITES[key];
      if (ready(img)) { c.drawImage(img, ox, oy, s, s); return; }
      if (d.cat === "weapon") drawWeaponInto(c, ox, oy, s, d.sub, d.color || "#d8d2c0");
      else drawArmorInto(c, ox, oy, s, d.color || "#b9c0c8");
      return;
    }
    if (d.cat === "ring" || d.cat === "necklace" || d.cat === "trinket") {
      const col = (isGear(e) && itemIdentified(e)) ? itemColor(e) : (d.color || "#cfc3a0");
      drawJewelInto(c, ox, oy, s, d.cat, col); return;
    }
    if (d.cat === "potion") { drawFlaskInto(c, ox, oy, s, consumColor(key)); return; }
    if (d.cat === "scroll") {
      if (ready(SPRITES.scroll)) { c.drawImage(SPRITES.scroll, ox, oy, s, s); return; }
      drawGlyphInto(c, ox, oy, s, "?", consumColor(key)); return;
    }
    drawGlyphInto(c, ox, oy, s, d.glyph || "?", d.color || "#cfc3a0");   // tools (torch) etc.
  }
  // Draw a floor item's icon (delegates to the shared renderer).
  function drawItemIcon(px, py, it) { renderIconInto(ctx, px, py, tile, it); }
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
    const k = easeOut(Math.min(1, (now - e.at) / (e.moveMs || MOVE_MS)));
    e.rx = e.ax + (e.x - e.ax) * k;
    e.ry = e.ay + (e.y - e.ay) * k;
    if (k >= 1 && e.moveMs) e.moveMs = 0;    // one-off slow slide (e.g. a charge) done → back to normal
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
  // On-screen speech: a quote that hovers over a monster for a beat (the Piper taunts).
  let speeches = [];
  const SPEECH_MS = 2200;
  function sayMonster(m, text, color) { speeches.push({ m, text, color: color || "#ffd98a", at: performance.now() }); }
  // A little projectile that flies tile-to-tile (ranged attacks). Purely visual.
  let projectiles = [];
  function spawnProjectile(x0, y0, x1, y1, color) {
    if (reduceMotion) return;
    const dist = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    projectiles.push({ x0, y0, x1, y1, color: color || "#ffe08a", at: performance.now(), dur: Math.min(750, 220 + dist * 90) });
  }
  // An expanding ring + radiating sparks at a tile (teleports, big impacts).
  let bursts = [];
  function spawnBurst(x, y, color) {
    if (reduceMotion) return;
    const parts = [];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.random() * 0.3; parts.push({ dx: Math.cos(a), dy: Math.sin(a), r: 0.8 + Math.random() * 0.6 }); }
    bursts.push({ x, y, color: color || "#b491d6", at: performance.now(), dur: 560, parts });
  }
  // A motion streak between two tiles (a charging bear, a fired arrow) — a fat
  // tapering line plus a couple of dust puffs so a fast dash reads clearly.
  let streaks = [];
  function spawnStreak(x0, y0, x1, y1, color, dur) {
    if (reduceMotion) return;
    streaks.push({ x0, y0, x1, y1, color: color || "#e8c07a", at: performance.now(), dur: dur || 360 });
  }
  // An expanding spiral at a tile (the teleport trap's signature twist).
  let spirals = [];
  function spawnSpiral(x, y, color, dur) {
    if (reduceMotion) return;
    spirals.push({ x, y, color: color || "#c79bff", at: performance.now(), dur: dur || 620 });
  }
  // A brief full-view colour wash (teleport whoosh).
  let screenFlash = null;
  function flashScreen(color, dur) { if (!reduceMotion) screenFlash = { color: color || "#b491d6", at: performance.now(), dur: dur || 420 }; }
  function snapPlayer() {
    player.rx = player.x; player.ry = player.y;
    player.lx = player.x; player.ly = player.y;
    player.ax = player.x; player.ay = player.y; player.at = 0;
  }
  function updateAnims(now) {
    animEntity(player, now);
    for (const m of monsters) animEntity(m, now);
    floaters = floaters.filter((f) => now - f.at < FLOAT_MS);
    speeches = speeches.filter((s) => now - s.at < SPEECH_MS && s.m && s.m.hp > 0);
    projectiles = projectiles.filter((p) => now - p.at < p.dur);
    bursts = bursts.filter((bt) => now - bt.at < bt.dur);
    streaks = streaks.filter((s) => now - s.at < s.dur);
    spirals = spirals.filter((s) => now - s.at < s.dur);
    if (screenFlash && now - screenFlash.at >= screenFlash.dur) screenFlash = null;
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
          else if (t === DOOR) drawDoor(px, py, !doorOpen(mx, my), b);
          else if (t === THORN) drawThorn(px, py, b);
        }
        dim(px, py, 1 - b);                                   // torch falloff / memory
        if (!vis) { ctx.fillStyle = "rgba(70,90,130,0.10)"; ctx.fillRect(px, py, tile, tile); }
      }
    }

    // wall torches (drawn after terrain so their glow sits on top)
    for (const tr of torches) {
      if (!inBounds(tr.x, tr.y) || !explored[tr.y][tr.x]) continue;
      const vis = visible[tr.y][tr.x];
      drawTorch(SX(tr.x), SY(tr.y), vis ? litBright(tr.x, tr.y) : MEM, now);
    }

    // route markers
    for (const s of walkPath) {
      if (!inBounds(s.x, s.y) || !explored[s.y][s.x]) continue;
      const px = SX(s.x), py = SY(s.y);
      const sz = tile * 0.2;
      ctx.fillStyle = "rgba(246,184,69,0.18)";
      ctx.fillRect(px + (tile - sz) / 2, py + (tile - sz) / 2, sz, sz);
    }

    // armed bomb danger zone: pulse the whole 3×3 red so it's obvious where to NOT be
    for (const t of traps) {
      if (!t.armed || t.armed <= 0) continue;
      const pulse = 0.28 + 0.22 * (0.5 + 0.5 * Math.sin(now / 130));
      for (let yy = t.y - 1; yy <= t.y + 1; yy++) for (let xx = t.x - 1; xx <= t.x + 1; xx++) {
        if (!inBounds(xx, yy) || !visible[yy][xx]) continue;
        ctx.fillStyle = "rgba(224,80,50," + pulse.toFixed(3) + ")";
        ctx.fillRect(SX(xx), SY(yy), tile, tile);
      }
    }
    // revealed traps (hidden ones stay invisible until spotted or sprung)
    for (const t of traps) {
      if (!t.revealed || !inBounds(t.x, t.y) || !visible[t.y][t.x]) continue;
      drawTrapMark(t, SX(t.x), SY(t.y), now);
      dim(SX(t.x), SY(t.y), (1 - litBright(t.x, t.y)) * 0.8);
    }

    // floor items
    for (const it of items) {
      if (!inBounds(it.x, it.y) || !visible[it.y][it.x]) continue;
      const px = SX(it.x), py = SY(it.y);
      if (it.key === "gold") drawCoin(px, py);
      else {
        // no rarity glow on the ground — gear is unidentified until you use it, so a
        // dropped item shouldn't telegraph how good it is
        drawItemIcon(px, py, it);
      }
      dim(px, py, (1 - litBright(it.x, it.y)) * 0.8);
    }

    // boss attack telegraph: a bold, pulsing red line — dodge off it!
    for (const m of monsters) {
      if (!m.beam || m.hp <= 0) continue;
      const pulse = 0.34 + 0.26 * Math.abs(Math.sin(now / 110));
      for (const [x, y] of m.beam.tiles) {
        if (!inBounds(x, y) || !visible[y][x]) continue;
        const px = SX(x), py = SY(y);
        ctx.fillStyle = "rgba(220,38,38," + pulse.toFixed(3) + ")";
        ctx.fillRect(px, py, tile, tile);
        ctx.strokeStyle = "rgba(255,96,96,0.95)"; ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, tile - 2, tile - 2);
      }
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

    // ranged projectiles (a small glowing bolt travelling tile-to-tile)
    for (const pr of projectiles) {
      const p = Math.min(1, (now - pr.at) / pr.dur);
      const x = pr.x0 + (pr.x1 - pr.x0) * p, y = pr.y0 + (pr.y1 - pr.y0) * p;
      const cx = SX(x) + tile / 2, cy = SY(y) + tile / 2;
      ctx.fillStyle = pr.color;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, tile * 0.22), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, tile * 0.14), 0, Math.PI * 2); ctx.fill();
    }

    // bursts: an expanding ring plus sparks flung outward (teleports etc.)
    for (const bt of bursts) {
      const p = Math.min(1, (now - bt.at) / bt.dur);
      const cx = SX(bt.x) + tile / 2, cy = SY(bt.y) + tile / 2;
      ctx.strokeStyle = bt.color; ctx.lineWidth = Math.max(1.5, tile * 0.08);
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.beginPath(); ctx.arc(cx, cy, tile * (0.15 + p * 1.1), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = bt.color;
      for (const q of bt.parts) {
        const d = p * q.r * tile * 1.3;
        const r = Math.max(1.5, tile * 0.11 * (1 - p));
        ctx.beginPath(); ctx.arc(cx + q.dx * d, cy + q.dy * d, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // motion streaks: a fat tapering dash from start tile to end tile (charge / arrow)
    for (const s of streaks) {
      const p = Math.min(1, (now - s.at) / s.dur);
      const x0 = SX(s.x0) + tile / 2, y0 = SY(s.y0) + tile / 2;
      const x1 = SX(s.x1) + tile / 2, y1 = SY(s.y1) + tile / 2;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.strokeStyle = s.color; ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2, tile * 0.34 * (1 - p));
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = Math.max(0, 0.5 * (1 - p));
      ctx.lineWidth = Math.max(1, tile * 0.12);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // spirals: an unfurling twist (the teleport trap's signature)
    for (const s of spirals) {
      const p = Math.min(1, (now - s.at) / s.dur);
      const cx = SX(s.x) + tile / 2, cy = SY(s.y) + tile / 2;
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1.5, tile * 0.09);
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.beginPath();
      const turns = 3, steps = 48, maxR = tile * 0.62 * p, rot = p * Math.PI * 2;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, a = t * turns * Math.PI * 2 + rot, r = maxR * t;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

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

    // monster speech: a taunt in a small dark bubble above the speaker
    for (const s of speeches) {
      const m = s.m; if (!m || m.hp <= 0) continue;
      const p = (now - s.at) / SPEECH_MS;
      const rise = Math.min(1, p * 4);                       // pop up quickly, then hold
      const bx = SX(m.rx != null ? m.rx : m.x) + tile / 2;
      const by = SY(m.ry != null ? m.ry : m.y) - tile * (0.35 + rise * 0.15);
      ctx.font = `700 ${Math.max(12, Math.floor(tile * 0.42))}px ${bodyFont()}`;
      const w = ctx.measureText(s.text).width, padX = tile * 0.24, padY = tile * 0.16;
      const bw = w + padX * 2, bh = Math.max(14, tile * 0.42) + padY * 2;
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - p) * 3));
      ctx.fillStyle = "rgba(12,9,5,0.86)";
      roundRect(bx - bw / 2, by - bh, bw, bh, Math.min(8, tile * 0.16)); ctx.fill();
      ctx.fillStyle = "rgba(12,9,5,0.86)";                    // little tail
      ctx.beginPath(); ctx.moveTo(bx - tile * 0.10, by); ctx.lineTo(bx + tile * 0.10, by); ctx.lineTo(bx, by + tile * 0.14); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1, tile * 0.03);
      roundRect(bx - bw / 2, by - bh, bw, bh, Math.min(8, tile * 0.16)); ctx.stroke();
      ctx.fillStyle = s.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(s.text, bx, by - bh / 2);
    }
    ctx.globalAlpha = 1;

    // boss health banner
    const bosses = monsters.filter((m) => m.boss && inBounds(m.x, m.y) && visible[m.y][m.x]);
    if (bosses.length) drawBossBar(bosses);

    // teleport whoosh: a brief full-view colour wash
    if (screenFlash) {
      const p = Math.min(1, (now - screenFlash.at) / screenFlash.dur);
      ctx.globalAlpha = Math.max(0, 0.55 * (1 - p));
      ctx.fillStyle = screenFlash.color;
      ctx.fillRect(0, 0, viewCols * tile, viewRows * tile);
      ctx.globalAlpha = 1;
    }
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
        const been = beenSeen[y][x];       // been there in person vs. only magic-mapped
        const px = ox + x * cell, py = oy + y * cell, sz = cell - gap;
        mctx.fillStyle = t === WALL ? (been ? "#4b3d27" : "#2c2417") : (been ? "#221b12" : "#151009");
        mctx.fillRect(px, py, sz, sz);
        if (t === STAIRS) { mctx.fillStyle = been ? "#f6b845" : "#7c6231"; mctx.fillRect(px, py, sz, sz); }
        else if (t === DOOR) { mctx.fillStyle = been ? "#8a6a3a" : "#4e3e24"; mctx.fillRect(px, py, sz, sz); }
        else if (t === THORN) { mctx.fillStyle = been ? "#4a6a34" : "#2c3d20"; mctx.fillRect(px, py, sz, sz); }
      }
    }
    const pc = Math.max(cell + 2, 5);
    mctx.fillStyle = "#ffd98a";
    mctx.fillRect(ox + player.x * cell - (pc - cell) / 2, oy + player.y * cell - (pc - cell) / 2, pc, pc);
    mctx.fillStyle = "#f6b845";
    mctx.font = `700 13px ${bodyFont()}`;
    mctx.textAlign = "left"; mctx.textBaseline = "top";
    mctx.fillText("FLOOR MAP · DEPTH " + depth, pad, pad - 8);
    // legend: bright vs dim = explored vs merely mapped
    mctx.textAlign = "left"; mctx.textBaseline = "top";
    mctx.font = `11px ${bodyFont()}`;
    mctx.fillStyle = "#cbb58a"; mctx.fillText("▉ explored", pad, pad + 12);
    mctx.fillStyle = "#5c4c30"; mctx.fillText("▉ mapped (not yet visited)", pad + 78, pad + 12);
    mctx.fillStyle = "rgba(236,226,207,0.5)";
    mctx.font = `12px ${bodyFont()}`;
    mctx.textAlign = "center"; mctx.textBaseline = "bottom";
    mctx.fillText("tap to close", w / 2, h - pad + 10);
  }
  function toggleMap(force) {
    mapOpen = force === undefined ? !mapOpen : force;
    if (mapOpen) { toggleInv(false); toggleChar(false); toggleExamine(false); }
    mapCanvas.hidden = !mapOpen;
    document.getElementById("btnMap").classList.toggle("on", mapOpen);
  }

  // ---- Pack / inventory ----------------------------------------------------
  let invOpen = false;
  function toggleInv(force) {
    invOpen = force === undefined ? !invOpen : force;
    if (invOpen) { selectedInvIdx = -1; selectedEquip = null; toggleMap(false); toggleChar(false); toggleExamine(false); renderInv(); }
    document.getElementById("inv").hidden = !invOpen;
    document.getElementById("btnBag").classList.toggle("on", invOpen);
  }
  function playerAtk() {
    const b = strBonus() + player.atkBonus;
    return (weaponDmgMin() + b) + "–" + (weaponDmgMax() + b);
  }
  // A colored, affix-annotated label for an equipped/carried gear instance.
  function equipLabel(inst) {
    if (!inst) return "—";
    const aff = itemAffixText(inst);
    return `<b style="color:${itemColor(inst)}">${itemName(inst)}</b>` + (aff ? ` <span style="opacity:.7">(${aff})</span>` : "");
  }
  // ---- Inventory: a 5×5 grid; consumables stack; each item has actions ---------
  let selectedInvIdx = -1;
  let selectedEquip = null;    // an equipped slot key selected for its detail/actions
  let pendingThrow = null;
  const EQUIP_ROWS = [["Weapon", "weapon"], ["Armor", "armor"], ["Ring", "ring1"], ["Ring", "ring2"], ["Trinket", "trinket"], ["Necklace", "necklace"]];
  const entryDef = (e) => (isGear(e) ? GEAR[e.key] : CONSUM[e.key]);
  const entryGlyph = (e) => { const d = entryDef(e); return (d && d.glyph) || "?"; };
  const entryColor = (e) => (isGear(e) ? itemColor(e) : consumColor(e.key));
  const entryName = (e) => (isGear(e) ? itemName(e) : displayName(e.key));
  function renderInv() {
    document.getElementById("invGold").textContent = player.gold + " gold";
    const df = defRange(armorDefMin() + vitResist(), armorDefMax() + vitResist());
    const cname = (DATA.classes[player.cls] || {}).name || "Adventurer";
    const withGear = (k) => { const g = equipStat(k); return eff(k) + (g ? `<span style="color:#7ec98a">(+${g})</span>` : ""); };
    const statLine = `STR ${withGear("STR")} · VIT ${withGear("VIT")} · DEX ${withGear("DEX")} · INT ${withGear("INT")} · RES ${withGear("RES")} · LCK ${withGear("LCK")}`;
    const pts = player.statPoints > 0 ? `  ·  <b style="color:#f0c14b">${player.statPoints} pts</b>` : "";
    document.getElementById("invStats").innerHTML =
      `${cname} · Lv ${player.level} · Atk ${playerAtk()} · Def ${df}` +
      `<br><span style="opacity:.85">${statLine}${pts}</span>`;
    // Equipped slots: each is a card with an icon, its slot label, and the item —
    // and it's tappable to see the item's details and unequip it.
    const equipHost = document.getElementById("invEquip");
    equipHost.innerHTML = "";
    for (const [lbl, sk] of EQUIP_ROWS) {
      const inst = player[sk];
      const row = document.createElement("div");
      row.className = "eq-row" + (inst ? "" : " empty") + (selectedEquip === sk ? " sel" : "");
      const ic = document.createElement("span"); ic.className = "eq-ic";
      if (inst) { const cv = document.createElement("canvas"); cv.width = 48; cv.height = 48; const cc = cv.getContext("2d"); cc.imageSmoothingEnabled = false; renderIconInto(cc, 0, 0, 48, inst); ic.appendChild(cv); }
      const lab = document.createElement("span"); lab.className = "eq-slot"; lab.textContent = lbl;
      const nm = document.createElement("span"); nm.className = "eq-name"; nm.innerHTML = inst ? equipLabel(inst) : '<span class="eq-empty">— empty —</span>';
      row.appendChild(ic); row.appendChild(lab); row.appendChild(nm);
      if (inst) row.addEventListener("click", () => { selectedEquip = (selectedEquip === sk ? null : sk); selectedInvIdx = -1; renderInv(); });
      equipHost.appendChild(row);
    }
    if (selectedInvIdx >= player.inv.length) selectedInvIdx = -1;
    const grid = document.getElementById("invGrid");
    grid.innerHTML = "";
    for (let i = 0; i < INV_MAX; i++) {
      const e = player.inv[i];
      const slot = document.createElement("div");
      slot.className = "inv-slot" + (e ? "" : " empty") + (i === selectedInvIdx ? " sel" : "");
      if (e) {
        const cv = document.createElement("canvas"); cv.className = "i-icon"; cv.width = 64; cv.height = 64;
        const cc = cv.getContext("2d"); cc.imageSmoothingEnabled = false; renderIconInto(cc, 0, 0, 64, e);
        slot.appendChild(cv);
        const cnt = e.count || 1;
        if (cnt > 1) { const c = document.createElement("span"); c.className = "i-count"; c.textContent = cnt; slot.appendChild(c); }
        slot.addEventListener("click", () => { selectedInvIdx = (selectedInvIdx === i ? -1 : i); selectedEquip = null; renderInv(); });
      }
      grid.appendChild(slot);
    }
    renderInvDetail();
  }
  function detailHeaderHTML(e) {
    const def = entryDef(e) || {};
    let sub;
    if (isGear(e)) {
      const cat = GEAR[e.key].cat;
      sub = cat === "weapon" ? ("dmg " + dDmgMin(e) + "–" + dDmgMax(e) + " · spd " + (GEAR[e.key].speed || 1)) : cat === "armor" ? ("def " + defRange(dDefMin(e), dDefMax(e))) : cat;
      if (!itemIdentified(e)) sub += " · unidentified (" + idPct(e) + "%)";
      else { const aff = itemAffixText(e); if (aff && aff !== "unidentified") sub += " · " + aff; }
    } else {
      sub = identified.has(e.key) ? (def.cat || "item") : "unidentified " + (def.cat || "item");
      if ((e.count || 1) > 1) sub += " · ×" + e.count;
    }
    return `<div class="d-name" style="color:${entryColor(e)}">${entryName(e)}</div><div class="d-sub">${sub}</div>`;
  }
  const mkBtn = (label, cls, fn) => { const b = document.createElement("button"); if (cls) b.className = cls; b.textContent = label; b.addEventListener("click", fn); return b; };
  function renderInvDetail() {
    const d = document.getElementById("invDetail");
    // An equipped slot is selected → show it, with Unequip / Drop.
    if (selectedEquip && player[selectedEquip]) {
      const e = player[selectedEquip];
      d.innerHTML = detailHeaderHTML(e);
      const acts = document.createElement("div"); acts.className = "inv-actions";
      acts.appendChild(mkBtn("Unequip", "primary", () => unequipSlot(selectedEquip)));
      acts.appendChild(mkBtn("Drop", "danger", () => dropEquip(selectedEquip)));
      d.appendChild(acts);
      return;
    }
    const e = player.inv[selectedInvIdx];
    if (!e) { d.innerHTML = '<div class="d-empty">Tap an item, or an equipped slot, to see its actions.</div>'; return; }
    const def = entryDef(e) || {};
    d.innerHTML = detailHeaderHTML(e);
    const acts = document.createElement("div"); acts.className = "inv-actions";
    const other = isGear(e) ? "Equip" : def.cat === "potion" ? "Drink" : def.cat === "scroll" ? "Read" : "Use";
    acts.appendChild(mkBtn(other, "primary", () => actItem(selectedInvIdx)));
    acts.appendChild(mkBtn("Throw", "", () => beginThrow(selectedInvIdx)));
    acts.appendChild(mkBtn("Drop", "danger", () => dropItem(selectedInvIdx)));
    d.appendChild(acts);
  }
  function unequipSlot(sk) {
    const it = player[sk]; if (!it) return;
    if (player.inv.length >= INV_MAX) { log("Your pack is full — drop something first."); return; }
    player[sk] = null; selectedEquip = null;
    player.inv.push(it);
    log("You put away the " + itemName(it) + ".");
    player.maxHp = computeMaxHp(); player.hp = Math.min(player.hp, player.maxHp);
    updateHUD(); worldTurn();
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  function dropEquip(sk) {
    const it = player[sk]; if (!it) return;
    const spot = dropSpot();
    if (!spot) { log("Nowhere to drop it here."); return; }
    player[sk] = null; selectedEquip = null;
    items.push(Object.assign({ x: spot.x, y: spot.y }, it));
    log("You drop the " + itemName(it) + ".");
    player.maxHp = computeMaxHp(); player.hp = Math.min(player.hp, player.maxHp);
    updateHUD(); worldTurn();
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  function actItem(idx) {
    const it = player.inv[idx];
    if (!it) return;
    if (isGear(it)) equipItem(idx);
    else useConsumable(idx);
  }
  function equipItem(idx) {
    const it = player.inv[idx];
    if (!it || !isGear(it)) return;
    const cat = GEAR[it.key].cat;
    const slots = EQUIP_SLOTS[cat] || ["weapon"];
    const slot = slots.find((s) => !player[s]) || slots[0];   // first empty slot, else swap the first
    player.inv.splice(idx, 1);
    if (player[slot]) player.inv.push(player[slot]);
    player[slot] = it;
    selectedInvIdx = -1;
    const verb = cat === "weapon" ? "You wield the " : cat === "armor" ? "You don the " : "You equip the ";
    log(verb + itemName(it) + ".");
    player.maxHp = computeMaxHp();               // VIT affixes can change max HP
    player.hp = Math.min(player.hp, player.maxHp);
    updateHUD();
    worldTurn();               // equipping takes a turn
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  function useConsumable(idx) {
    const it = player.inv[idx];
    if (!it) return;
    const def = CONSUM[it.key];
    if (def.effect === "burn") {                 // a torch: only spent if there are thorns to burn
      if (!adjacentThorns().length) { log("No thorns within reach to burn."); return; }
      takeOne(idx); selectedInvIdx = -1;
      burnThorns();
      updateHUD(); worldTurn();
      if (dead) { toggleInv(false); return; }
      renderInv();
      return;
    }
    identified.add(it.key);      // using an item reveals what it is
    takeOne(idx); selectedInvIdx = -1;
    applyEffect(def.effect);
    updateHUD();
    if (dead) { toggleInv(false); return; }
    worldTurn();
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  // Drop one unit onto the floor at (or beside) the player.
  function dropSpot() {
    if (passable(player.x, player.y) && !itemAt(player.x, player.y)) return { x: player.x, y: player.y };
    for (const [dx, dy] of DIRS8) {
      const x = player.x + dx, y = player.y + dy;
      if (passable(x, y) && map[y][x] !== THORN && !itemAt(x, y)) return { x, y };
    }
    return null;
  }
  function dropItem(idx) {
    const e = player.inv[idx]; if (!e) return;
    const spot = dropSpot();
    if (!spot) { log("Nowhere to drop it here."); return; }
    const one = takeOne(idx); selectedInvIdx = -1;
    items.push(Object.assign({ x: spot.x, y: spot.y }, one));
    log("You drop the " + entryName(one) + ".");
    updateHUD(); worldTurn();
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  function beginThrow(idx) {
    if (!player.inv[idx]) return;
    pendingThrow = idx;
    toggleInv(false);
    log("Throw — tap a tile within sight.");
    updateHotbar();
  }
  function executeThrow(idx, tx, ty) {
    const e = player.inv[idx];
    if (!e) { pendingThrow = null; return; }
    if (!inBounds(tx, ty) || !visible[ty][tx] || cheb(player.x, player.y, tx, ty) > 6) { log("Too far to throw there."); pendingThrow = null; updateHotbar(); return; }
    const one = takeOne(idx); selectedInvIdx = -1;
    const nm = entryName(one);
    const isPotion = !isGear(one) && CONSUM[one.key] && CONSUM[one.key].cat === "potion";
    spawnProjectile(player.x, player.y, tx, ty, isGear(one) ? "#d8cfa0" : consumColor(one.key));  // the item arcs to its target
    if (isPotion) {
      identified.add(one.key);
      floatText(tx, ty, "✸", consumColor(one.key));
      const m = monsterAt(tx, ty);
      if (m && CONSUM[one.key].effect === "poison") {
        const d = randInt(3, 6); m.hp -= d; flash(m); floatText(m.x, m.y, "☠-" + d, "#9ad06a");
        addDot(m, { tag: "poison", dmg: 2, rounds: 5, icon: "☠", color: "#9ad06a" }, true);
        log("The " + nm + " bursts over the " + monName(m) + "!", "hit");
        if (m.hp <= 0) killMonster(m, "succumbs to poison");
      } else {
        log("The " + nm + " shatters, its magic wasted.");
      }
    } else {
      const spot = passable(tx, ty) ? { x: tx, y: ty } : nearestFreeFloor(tx, ty);
      if (spot) { items.push(Object.assign({ x: spot.x, y: spot.y }, one)); log("You throw the " + nm + "."); }
    }
    // A thrown item that lands on a trap sets it off (from a distance).
    const trap = trapAt(tx, ty);
    if (trap && !trap.sprung) triggerTrap(trap, true);
    pendingThrow = null;
    updateHUD();
    if (dead) return;
    worldTurn();
    if (dead) return;
    updateHotbar();
  }
  function adjacentThorns() {
    const out = [];
    for (const [dx, dy] of DIRS8) { const x = player.x + dx, y = player.y + dy; if (isThorn(x, y)) out.push([x, y]); }
    return out;
  }
  function burnThorns() {
    const cells = adjacentThorns();
    for (const [x, y] of cells) { map[y][x] = FLOOR; floatText(x, y, "🔥", "#f6b845"); }
    computeFOV();
    log(cells.length === 1 ? "The torch sets the thorns ablaze — they burn away."
                           : "Fire races through the brambles — " + cells.length + " thorns burn away.", "hit");
  }
  function applyEffect(effect) {
    const fx = String(effect || "").toLowerCase();
    if (fx === "heal") {
      const amt = 8 + player.level * 2;
      player.hp = Math.min(player.maxHp, player.hp + amt);
      log("You drink a Potion of Healing. (+" + amt + ")", "hit");
    } else if (fx === "strength") {
      player.stats.STR += 1;
      log("Strength surges through your arms. (+1 STR)", "hit");
    } else if (fx === "vitality") {
      const before = player.maxHp;
      player.stats.VIT += 1;
      player.maxHp = computeMaxHp();
      player.hp += Math.max(0, player.maxHp - before);   // the freshly-gained HP is granted too
      log("Vigor floods your body. (+1 VIT)", "hit");
    } else if (fx === "intelligence") {
      player.stats.INT += 1;
      log("Your mind sharpens. (+1 INT)", "hit");
    } else if (fx === "stone skin" || fx === "stone_skin" || fx === "stoneskin") {
      player.stoneSkin = { turns: 40 };
      floatText(player.x, player.y, "🛡", "#bcd3e6");
      log("Your skin hardens to stone — blows glance off you. (40 turns)", "hit");
    } else if (fx === "skill_point" || fx === "skill point" || fx === "insight") {
      player.statPoints += 1;
      renderChar(); updateHotbar();
      floatText(player.x, player.y, "★", "#f0c14b");
      log("Insight blooms — you gain a skill point.", "hit");
    } else if (fx === "poison") {
      const amt = randInt(4, 8);
      player.hp -= amt;
      log("It was poison! (-" + amt + ")", "hurt");
      if (player.hp <= 0) die();
    } else if (fx === "map") {
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) explored[y][x] = true;
      log("The layout of this level floods into your mind.");
    } else if (fx === "teleport") {
      const reach = floodReach(player.x, player.y, true);   // only tiles you could walk to (never into a thorn vault)
      for (let t = 0; t < 400; t++) {
        const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
        if (passable(x, y) && !monsterAt(x, y) && reach.has(y * MAP_W + x)) {
          spawnBurst(player.x, player.y, "#9ad0ff");
          player.x = x; player.y = y; computeFOV(); snapPlayer();
          flashScreen("#4f77b0", 400);
          spawnBurst(player.x, player.y, "#9ad0ff");
          floatText(player.x, player.y, "✦", "#cfeaff");
          break;
        }
      }
      log("Reality lurches — you stand somewhere new.");
    }
  }

  // ---- State: examine, skill targeting, character screen -------------------
  let examineMode = false;
  let pendingSkill = null;
  let charOpen = false;
  let charTab = "stats";

  // ---- Skills --------------------------------------------------------------
  // Usable skills are built from the class's skill tree. A tree cell becomes a
  // real skill once it carries a `ranks` array (per-level mechanics); cells with
  // only description text are authoring scaffold and are skipped. `kind` picks the
  // behavior: "rush" (directional dash), "spin" (area strike), or "passive" (a
  // continuous modifier). Passives may set `when` = a weapon subtype they require.
  // Falls back to a class's legacy `skills` map if the tree wires nothing yet.
  let _skillCache = { cls: null, skills: {}, byPos: {} };
  function treeSkills(cls) {
    if (_skillCache.cls === cls) return _skillCache;
    const c = DATA.classes[cls] || {};
    const tree = Array.isArray(c.skillTree) ? c.skillTree : [];
    const skills = {}, byPos = {};
    const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    tree.forEach((tier, t) => (tier || []).forEach((cell, s) => {
      if (!cell || !cell.name || !Array.isArray(cell.ranks) || !cell.ranks.length) return;
      const key = cell.key || slug(cell.name);
      skills[key] = {
        name: cell.name, icon: cell.icon || "✦", desc: cell.desc || "",
        kind: cell.kind || "passive", when: cell.when || null,
        max: cell.ranks.length, ranks: cell.ranks, levels: cell.levels || [],
        req: cell.req || [], pos: [t, s],
      };
      byPos[t + "," + s] = key;
    }));
    if (!Object.keys(skills).length && c.skills) {   // legacy: a class that still lists skills directly
      for (const k of Object.keys(c.skills)) skills[k] = Object.assign({ kind: k, when: null, levels: [], req: [], pos: null }, c.skills[k]);
    }
    _skillCache = { cls, skills, byPos };
    return _skillCache;
  }
  // Ourn's Blink — an active skill granted by the "ourn" boon (not a class-tree
  // skill). It freezes every monster for 5 turns; cooldown scales with Intelligence.
  const OURN_KEY = "ourn_blink";
  const OURN_SKILL = { name: "Ourn's Blink", icon: "⏳", kind: "freeze", max: 1, ranks: [{ freeze: 5 }],
    levels: ["Freeze every monster for 5 turns (free action). Cooldown 200 − INT×2."],
    desc: "Still time — every monster freezes for 5 turns." };
  const ournCooldown = () => Math.max(10, 200 - eff("INT") * 2);   // 200 − INT×2
  function classSkills() {
    const base = treeSkills(player.cls).skills;
    if (player.boons && player.boons.has("ourn")) return Object.assign({}, base, { [OURN_KEY]: OURN_SKILL });
    return base;
  }
  function skillDef(key) { return classSkills()[key]; }
  function skillCur(key) { const st = player.skills[key], d = skillDef(key); return st && st.rank > 0 ? d.ranks[st.rank - 1] : null; }
  function skillAtPos(t, s) { return treeSkills(player.cls).byPos[t + "," + s]; }
  function prereqsMet(d) {
    if (!d.req || !d.req.length) return true;
    return d.req.every(([t, s]) => { const k = skillAtPos(t, s); const st = k && player.skills[k]; return !!(st && st.rank >= 1); });
  }
  function prereqNames(d) {
    return (d.req || []).map(([t, s]) => { const k = skillAtPos(t, s); return (k && classSkills()[k]) ? classSkills()[k].name : null; }).filter(Boolean);
  }
  // Sum a passive-skill modifier (dmg/acc/eva/…) across learned passives whose
  // condition (`when` = required weapon subtype) currently holds.
  function passiveMod(field) {
    let v = 0; const sk = classSkills();
    for (const key in sk) {
      const d = sk[key]; if (d.kind !== "passive") continue;
      const st = player.skills[key]; if (!st || st.rank < 1) continue;
      if (d.when && d.when !== weaponSub()) continue;
      const r = d.ranks[st.rank - 1] || {}; if (r[field] != null) v += r[field];
    }
    return v;
  }

  function learnSkill(key) {
    const d = skillDef(key), st = player.skills[key];
    if (!d || !st || st.rank >= d.max || player.statPoints <= 0) return;
    if (!prereqsMet(d)) { log("Requires " + (prereqNames(d).join(", ") || "a prerequisite") + " first.", ""); return; }
    player.statPoints--; st.rank++;
    log((st.rank === 1 ? "Learned " : "Upgraded ") + d.name + " (rank " + st.rank + ").", "hit");
    renderChar(); updateHotbar();
  }
  function useSkill(key) {
    if (dead || mapOpen || invOpen || charOpen || boonPending) return;
    const st = player.skills[key], d = skillDef(key);
    if (!st || st.rank < 1 || !d) return;
    if (d.kind === "passive") { log(d.name + " is always active.", ""); return; }
    if (st.cd > 0) { log(d.name + " is on cooldown (" + st.cd + ").", ""); return; }
    if (d.kind === "rush") beginRush(key);
    else if (d.kind === "spin") executeSpin(key);
    else if (d.kind === "freeze") executeOurn(key);
  }
  // Ourn's Blink: stop time — freeze every living monster for 5 turns. A free
  // action (the clock doesn't advance), so you get the full head start.
  function executeOurn(key) {
    const cur = skillCur(key) || { freeze: 5 };
    let n = 0;
    for (const m of monsters) if (m.hp > 0) { m.stun = Math.max(m.stun || 0, cur.freeze || 5); n++; }
    flashScreen("#2f4f6a", 320); floatText(player.x, player.y, "⏳", "#9ad0ff");
    log(n ? "Ourn stills time — every foe freezes for " + (cur.freeze || 5) + " turns." : "Ourn stills time, but nothing stirs here.", "hit");
    player.skills[key].cd = ournCooldown();
    updateHotbar(); updateHUD();
  }
  function beginRush(key) {
    pendingSkill = pendingSkill === key ? null : key;
    const d = skillDef(key);
    log(pendingSkill ? d.name + " — choose a direction (tap a nearby tile or press an arrow)." : d.name + " cancelled.");
    updateHotbar();
  }
  function executeRush(key, dir) {
    pendingSkill = null;
    const cur = skillCur(key);
    if (!cur) { updateHotbar(); return; }
    let steps = 0;
    while (steps <= 60) {
      const nx = player.x + dir[0], ny = player.y + dir[1];
      const mon = monsterAt(nx, ny);
      if (mon) {
        bump(player, nx, ny); attack(player, mon, cur.dmg);
        if (cur.stun && mon.hp > 0 && Math.random() < cur.stun) { mon.stun = (mon.stun || 0) + 1; floatText(mon.x, mon.y, "stun!", "#cfe6ff"); }
        break;
      }
      if (isWall(nx, ny)) {
        bump(player, nx, ny);
        const self = randInt(2, 4);
        player.hp -= self; flash(player); floatText(player.x, player.y, "-" + self, "#ff8f84");
        updateHUD(); log("You slam into the wall! (-" + self + ")", "hurt");
        if (player.hp <= 0) { player.skills[key].cd = cur.cd; die(); updateHotbar(); return; }
        break;
      }
      player.x = nx; player.y = ny; steps++;
      if (map[ny][nx] === THORN) {                       // dashing through brambles stings too
        const td = randInt(5, 10);
        player.hp -= td; flash(player); floatText(player.x, player.y, "-" + td, "#ff8f84");
        if (player.hp <= 0) { player.skills[key].cd = cur.cd; updateHUD(); computeFOV(); die(); updateHotbar(); return; }
      }
      computeFOV(); pickUp();
      if (map[player.y][player.x] === STAIRS) { player.skills[key].cd = cur.cd; descend(); updateHotbar(); return; }
    }
    computeFOV();
    player.skills[key].cd = cur.cd;
    worldTurn();
  }
  function executeSpin(key) {
    const cur = skillCur(key);
    if (!cur) return;
    const R = cur.range || 1;
    let hit = 0;
    for (const m of monsters.slice()) {
      if (m.hp > 0 && !(m.x === player.x && m.y === player.y) && cheb(m.x, m.y, player.x, player.y) <= R) {
        attack(player, m, cur.dmg); hit++;
        if (dead) return;
      }
    }
    log(hit ? ("You spin, striking " + hit + (hit === 1 ? " foe." : " foes.")) : "You spin, hitting nothing.", hit ? "hit" : "");
    player.skills[key].cd = cur.cd;
    if (cur.freeAction) { updateHotbar(); updateHUD(); }   // free action: the turn clock doesn't advance
    else worldTurn();
  }

  // ---- Examine -------------------------------------------------------------
  function toggleExamine(force) {
    examineMode = force === undefined ? !examineMode : force;
    if (examineMode) { pendingSkill = null; log("Examine — tap anything to inspect it."); updateHotbar(); }
    document.getElementById("btnExamine").classList.toggle("on", examineMode);
  }
  function describeTile(x, y) {
    if (!inBounds(x, y) || !explored[y][x]) { log("You can't make out anything there."); return; }
    const m = monsters.find((mm) => mm.hp > 0 && mm.x === x && mm.y === y);
    if (m && visible[y][x]) {
      const tags = [];
      if (m.boss) tags.push("BOSS");
      if (m.ranged) tags.push("ranged");
      if (m.charge) tags.push("charges");
      if ((m.eva != null ? m.eva : MON_EVA) >= 12) tags.push("evasive");
      if ((m.acc != null ? m.acc : MON_ACC) >= 12) tags.push("accurate");
      if (!m.aware) tags.push("unaware");
      log(monName(m) + " — Lv " + (m.level || 1) + ", HP " + Math.max(0, m.hp) + "/" + m.maxHp + (tags.length ? " (" + tags.join(", ") + ")" : ""));
      return;
    }
    if (x === player.x && y === player.y) {
      log("You — " + ((DATA.classes[player.cls] || {}).name || "Adventurer") + ", HP " + player.hp + "/" + player.maxHp);
      return;
    }
    const tr = trapAt(x, y);
    if (tr && visible[y][x]) {
      tr.revealed = true;                       // examining a tile uncovers a trap on it
      const def = TRAPS[tr.key] || {};
      log((def.name || "Trap") + (tr.sprung ? " (already sprung)" : " — step carefully around it."));
      return;
    }
    const it = items.find((i) => i.x === x && i.y === y);
    if (it && visible[y][x]) {
      if (it.key === "gold") { log(it.amount + " gold"); return; }
      const aff = isGear(it) ? itemAffixText(it) : "";
      log(itemName(it) + (aff ? " — " + aff : "")); return;
    }
    const torch = torches.find((tr) => tr.x === x && tr.y === y);
    if (torch) { log("A wall torch — tap it to take it; fire clears thorns."); return; }
    const t = map[y][x];
    log(t === WALL ? "A wall." : t === STAIRS ? "The way onward." :
        t === DOOR ? "A " + doorWord() + " — it opens as you pass and closes behind you, blocking sight." :
        t === THORN ? "A wall of thorns — you can force through, but it'll draw blood. Something waits beyond." :
        "Open ground.");
  }

  // ---- Character screen ----------------------------------------------------
  function toggleChar(force) {
    charOpen = force === undefined ? !charOpen : force;
    if (charOpen) { toggleInv(false); toggleMap(false); toggleExamine(false); renderChar(); }
    document.getElementById("char").hidden = !charOpen;
    document.getElementById("btnChar").classList.toggle("on", charOpen);
  }
  function renderChar() {
    const body = document.getElementById("charBody");
    if (!body) return;
    body.innerHTML = charTab === "stats" ? charStatsHTML() : charTab === "skills" ? charSkillsHTML() : charBoonsHTML();
    if (charTab === "skills") {
      for (const key of Object.keys(classSkills())) {
        const btn = document.getElementById("upg-" + key);
        if (btn) btn.addEventListener("click", () => learnSkill(key));
      }
    }
  }
  function charStatsHTML() {
    const cname = (DATA.classes[player.cls] || {}).name || "Adventurer";
    const df = defRange(armorDefMin() + vitResist(), armorDefMax() + vitResist());
    const effDesc = { STR: "+" + strBonus() + " dmg", VIT: computeMaxHp() + " HP", DEX: "acc " + playerAcc() + " / eva " + playerEva(), INT: "—", RES: "—", LCK: Math.round(critChance() * 100) + "% crit" };
    const cells = ["STR", "VIT", "DEX", "INT", "RES", "LCK"].map((k) => {
      const g = equipStat(k);
      const val = player.stats[k] + (g ? `<span style="color:#7ec98a;font-size:11px"> +${g}</span>` : "");
      return `<div class="cstat"><span>${k}<small>${effDesc[k]}</small></span><b>${val}</b></div>`;
    }).join("");
    const pts = player.statPoints > 0 ? `<span class="cpts">${player.statPoints} unspent points</span> — spend them under Skills.` : "No unspent points.";
    return `<div class="cline"><b>${cname}</b> · Level ${player.level} · ${player.gold} gold</div>` +
      `<div class="cline">Attack <b>${playerAtk()}</b> · Defense <b>${df}</b> · HP <b>${player.hp}/${player.maxHp}</b> · MP <b>${player.mp}/${player.maxMp}</b></div>` +
      `<div class="cline">Crit <b>${Math.round(critChance() * 100)}%</b> for <b>${Math.round(critMult() * 100)}%</b> damage</div>` +
      `<div class="cstat-grid">${cells}</div>` +
      `<div class="cline">${pts}</div>`;
  }
  function charSkillsHTML() {
    const sk = classSkills();
    const keys = Object.keys(sk);
    if (!keys.length) return `<div class="cline">This class has no skills yet.</div>`;
    const fmt = (r) => {
      const p = [];
      if (r.dmg != null) p.push((r.dmg >= 0 ? "+" : "") + r.dmg + " dmg");
      if (r.acc != null) p.push("+" + r.acc + " acc");
      if (r.eva != null) p.push("+" + r.eva + " eva");
      if (r.range) p.push("range " + r.range);
      if (r.stun) p.push(Math.round(r.stun * 100) + "% stun");
      if (r.freeAction) p.push("free action");
      if (r.cd != null) p.push(r.cd + "t cd");
      return p.join(", ") || "—";
    };
    let html = `<div class="cline"><span class="cpts">${player.statPoints}</span> points to spend</div>`;
    for (const key of keys) {
      const d = sk[key], st = player.skills[key];
      const locked = st.rank === 0 && !prereqsMet(d);
      const curTxt = st.rank > 0 ? (d.levels[st.rank - 1] || fmt(d.ranks[st.rank - 1])) : null;
      const nextTxt = st.rank < d.max ? (d.levels[st.rank] || fmt(d.ranks[st.rank])) : "Maxed.";
      const canUp = st.rank < d.max && player.statPoints > 0 && !locked;
      const label = locked ? "🔒 Locked" : st.rank === 0 ? "Learn (1 pt)" : st.rank < d.max ? "Upgrade (1 pt)" : "Maxed";
      const kindTag = d.kind === "passive" ? " · passive" : "";
      const reqTxt = locked ? `<div class="sdesc" style="color:#e0a05a">Requires: ${prereqNames(d).join(", ") || "a prerequisite"}</div>` : "";
      html += `<div class="skillrow"><div class="sh"><span class="sname"><span class="ic">${d.icon}</span>${d.name}</span>` +
        `<span class="srank">rank ${st.rank}/${d.max}${kindTag}</span></div>` +
        `<div class="sdesc">${d.desc}</div>` + reqTxt +
        `<div class="snext">${curTxt ? "Now: " + curTxt + "<br>" : ""}${st.rank < d.max ? "Next: " + nextTxt : nextTxt}</div>` +
        `<button class="upg" id="upg-${key}" ${canUp ? "" : "disabled"}>${label}</button></div>`;
    }
    return html;
  }
  function charBoonsHTML() {
    const boons = DATA.boons || {};
    const owned = player.boons ? [...player.boons] : [];
    let list = "";
    if (owned.length) {
      for (const k of owned) {
        const g = boons[k]; if (!g) continue;
        list += `<div class="god"><span style="color:${g.color || "#f0c14b"}">${g.icon || "✦"}</span> <b style="color:${g.color || "#f0c14b"}">${g.name}</b> — ${g.desc || ""}</div>`;
      }
    } else {
      list = `<div class="god"><em>None yet.</em></div>`;
    }
    return `<div class="cboon">Defeat a boss and a god offers you a blessing — one of three, chosen on the spot. They last the whole run.<br><br>${list}</div>`;
  }

  // ---- Hotbar --------------------------------------------------------------
  function makeSlot(icon, label, ready, cd, arming, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "slot" + (ready ? " ready" : " cool") + (arming ? " arming" : "");
    b.innerHTML = `<span>${icon}</span><span class="lbl">${label}</span>` + (cd ? `<span class="cd">${cd}</span>` : "");
    b.addEventListener("click", onClick);
    return b;
  }
  function updateHotbar() {
    const bar = document.getElementById("hotbar");
    if (!bar) return;
    bar.innerHTML = "";
    bar.appendChild(makeSlot("⏳", "Wait", true, 0, false, () => waitTurn()));
    for (const key of Object.keys(player.skills || {})) {
      const st = player.skills[key], d = skillDef(key);
      if (!st || st.rank < 1 || !d || d.kind === "passive") continue;   // passives are always-on, no button
      bar.appendChild(makeSlot(d.icon, d.name, st.cd <= 0, st.cd > 0 ? st.cd : 0, pendingSkill === key, () => useSkill(key)));
    }
  }

  // ---- Main loop -----------------------------------------------------------
  const STEP_MS = 130;   // pace of auto-walk steps (kept just above the glide time)
  let lastT = 0, acc = 0;
  function frame(t) {
    if (!lastT) lastT = t;
    const dt = t - lastT;
    lastT = t;

    if (walkPath.length && !mapOpen && !invOpen && !charOpen && !dead) {
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
    // Arrived beside a torch we were walking to → lift it off the wall.
    if (pendingTorch && !walkPath.length && !dead) {
      if (cheb(player.x, player.y, pendingTorch.x, pendingTorch.y) === 1 && torches.indexOf(pendingTorch) >= 0) takeTorch(pendingTorch);
      pendingTorch = null;
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
    if (boonPending) return;                     // choose your boon first
    const key = (e.key || "").toLowerCase();
    if (key === "c") { e.preventDefault(); toggleChar(); return; }
    if (charOpen) { if (e.key === "Escape" || key === "c") toggleChar(false); return; }
    if (key === "i") { e.preventDefault(); toggleInv(); return; }
    if (invOpen) { if (e.key === "Escape") toggleInv(false); return; }
    if (key === "m") { e.preventDefault(); toggleMap(); return; }
    if (mapOpen) { if (e.key === "Escape") toggleMap(false); return; }
    if (key === "x") { e.preventDefault(); toggleExamine(); return; }
    if (e.key === "Escape" && (examineMode || pendingSkill || pendingThrow != null)) { examineMode = false; pendingSkill = null; pendingThrow = null; toggleExamine(false); updateHotbar(); return; }
    if (key === "z" || e.key === "." || e.code === "Numpad5") { e.preventDefault(); waitTurn(); return; }
    if (key >= "1" && key <= "9") {                        // number keys → learned active skills, in order
      const actives = Object.keys(classSkills()).filter((k) => { const d = classSkills()[k]; return d.kind !== "passive" && player.skills[k] && player.skills[k].rank >= 1; });
      const s = actives[parseInt(key, 10) - 1];
      if (s) { e.preventDefault(); useSkill(s); return; }
    }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(zoom * 1.2); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom(zoom / 1.2); return; }
    const dir = BY_CODE[e.code] || BY_KEY[e.key] || BY_KEY[key];
    if (dir) {
      e.preventDefault();
      if (pendingSkill && skillDef(pendingSkill) && skillDef(pendingSkill).kind === "rush") { executeRush(pendingSkill, dir); return; }
      walkPath = []; playerAct(dir[0], dir[1]);
    }
  });

  // ---- Buttons -------------------------------------------------------------
  document.getElementById("btnMap").addEventListener("click", () => toggleMap());
  document.getElementById("btnBag").addEventListener("click", () => toggleInv());
  { const en = document.getElementById("enemies"); if (en) en.addEventListener("click", cycleEnemyFocus); }
  document.getElementById("btnChar").addEventListener("click", () => toggleChar());
  document.getElementById("btnExamine").addEventListener("click", () => toggleExamine());
  function waitTurn() { if (dead || mapOpen || invOpen || charOpen || boonPending) return; walkPath = []; worldTurn(); }
  mapCanvas.addEventListener("click", () => toggleMap(false));

  // tap outside the pack card closes it
  const invOverlay = document.getElementById("inv");
  invOverlay.addEventListener("click", (e) => { if (e.target === invOverlay) toggleInv(false); });
  document.getElementById("invClose").addEventListener("click", () => toggleInv(false));

  // character screen: tabs, close, tap-outside
  document.getElementById("charClose").addEventListener("click", () => toggleChar(false));
  const charOverlay = document.getElementById("char");
  charOverlay.addEventListener("click", (e) => { if (e.target === charOverlay) toggleChar(false); });
  for (const t of document.querySelectorAll(".ctab")) {
    t.addEventListener("click", () => {
      charTab = t.getAttribute("data-tab");
      for (const o of document.querySelectorAll(".ctab")) o.classList.toggle("on", o === t);
      renderChar();
    });
  }

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
  let touchMode = null, tapStart = null, panLast = null, pinchStartDist = 0, pinchStartZoom = 1, lastTouchEnd = 0;
  const dist2 = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  function tileAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const colF = (clientX - rect.left) / (rect.width / viewCols);
    const rowF = (clientY - rect.top) / (rect.height / viewRows);
    return [Math.floor(camX + colF), Math.floor(camY + rowF)];
  }
  canvas.addEventListener("touchstart", (e) => {
    if (mapOpen || invOpen || charOpen || dead || boonPending) return;
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
      return;
    }
    if (e.touches.length !== 1 || (touchMode !== "tap" && touchMode !== "drag")) return;
    const t = e.touches[0];
    if (touchMode === "tap" && Math.hypot(t.clientX - tapStart.x, t.clientY - tapStart.y) > 14) {
      touchMode = "drag"; panLast = { x: t.clientX, y: t.clientY };
    }
    if (touchMode === "drag") { e.preventDefault(); panBy(t.clientX - panLast.x, t.clientY - panLast.y); panLast = { x: t.clientX, y: t.clientY }; }
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    lastTouchEnd = performance.now();     // suppress the synthetic click (tap or drag)
    if (touchMode === "tap" && tapStart) {
      e.preventDefault();
      const [tx, ty] = tileAt(tapStart.x, tapStart.y);
      walkTo(tx, ty);
    }
    if (e.touches.length === 0) { touchMode = null; tapStart = null; panLast = null; }
  }, { passive: false });
  canvas.addEventListener("click", (e) => {
    if (performance.now() - lastTouchEnd < 500 || mouseDragged) return;
    const [tx, ty] = tileAt(e.clientX, e.clientY);
    walkTo(tx, ty);
  });
  // Mouse drag = pan the free-look camera (desktop parity with swipe).
  let mouseDown = null, mouseDragged = false;
  canvas.addEventListener("mousedown", (e) => { mouseDown = { x: e.clientX, y: e.clientY }; mouseDragged = false; });
  window.addEventListener("mousemove", (e) => {
    if (!mouseDown) return;
    if (!mouseDragged && Math.hypot(e.clientX - mouseDown.x, e.clientY - mouseDown.y) > 4) mouseDragged = true;
    if (mouseDragged) { panBy(e.clientX - mouseDown.x, e.clientY - mouseDown.y); mouseDown = { x: e.clientX, y: e.clientY }; }
  });
  window.addEventListener("mouseup", () => { mouseDown = null; });

  // ---- Dev hook ------------------------------------------------------------
  window.cantori = {
    descend, regenerate: generateLevel, setZoom, toggleMap, toggleInv, toggleChar, restart,
    dname: (k) => displayName(k), dcolor: (k) => consumColor(k),
    stoneSkinTurns: () => (player.stoneSkin ? player.stoneSkin.turns : 0),
    hurt: (n) => { player.hp -= n; updateHUD(); if (player.hp <= 0) die(); },
    give: (k) => { if (GEAR[k]) invAdd(rollItem(k, depth)); else if (defOf(k)) invAdd({ key: k }); },
    // deterministic gear for tests: giveGear("sword", {rarity, plus, stats:[{stat,val}], enchants:[...]})
    giveGear: (k, o) => { if (GEAR[k]) player.inv.push(Object.assign(mkBase(k), o || {})); },
    rollItem: (k, f) => rollItem(k, f != null ? f : depth),
    rollGear: (f) => rollGearDrop(f != null ? f : depth),
    rollTrinket: (f) => rollTrinket(f != null ? f : depth),
    costs: () => ({ walk: walkCost(), attack: attackCost() }),
    offerBoons, pickBoon,
    giveBoon: (k) => { if (!player.boons) player.boons = new Set(); player.boons.add(k); if (k === "kethara") grantPurpleArmor(); if (k === "ourn") player.skills[OURN_KEY] = { rank: 1, cd: 0 }; updateHUD(); updateHotbar(); },
    addTrap: (key, x, y) => { traps.push({ x, y, key, revealed: true, sprung: false }); },
    springTrap: (i) => { if (traps[i]) triggerTrap(traps[i]); },
    throwAt: (idx, x, y) => executeThrow(idx, x, y),
    anims: () => ({ projectiles: projectiles.length, streaks: streaks.length, spirals: spirals.length, bursts: bursts.length }),
    rooms: () => lastRooms.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    attachInfo: () => ({ attached: lastAttach, total: lastRooms.length }),
    grant: (n) => { player.statPoints += (n || 1); renderChar(); updateHotbar(); },
    learn: (k) => learnSkill(k),
    doSkill: (k) => useSkill(k),
    rush: (dx, dy) => executeRush([dx, dy]),
    spin: () => executeSpin(),
    skills: () => JSON.parse(JSON.stringify(player.skills)),
    examineAt: (x, y) => describeTile(x, y),
    peek: () => {
      let ex = 0;
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (explored[y][x]) ex++;
      return {
        depth, hp: player.hp, maxHp: player.maxHp, mp: player.mp, maxMp: player.maxMp,
        acc: playerAcc(), eva: playerEva(), lvlHp: player.lvlHp, level: player.level, xp: player.xp,
        cls: player.cls, stats: Object.assign({}, player.stats), statPoints: player.statPoints,
        boons: player.boons ? [...player.boons] : [], boonPending,
        atk: playerAtk(), atkBonus: player.atkBonus, gold: player.gold, weapon: player.weapon, armor: player.armor,
        ring1: player.ring1, ring2: player.ring2, trinket: player.trinket, necklace: player.necklace,
        effStats: { STR: eff("STR"), INT: eff("INT"), VIT: eff("VIT"), DEX: eff("DEX"), RES: eff("RES"), LCK: eff("LCK") },
        weaponDmg: [weaponDmgMin(), weaponDmgMax()], weaponAccuracy: weaponAccuracy(), weaponSpeed: weaponSpeed(), armorDef: [armorDefMin(), armorDefMax()],
        inv: player.inv.map((i) => i.key), invItems: player.inv.map((i) => Object.assign({}, i)), identified: [...identified],
        x: player.x, y: player.y, dead, explored: ex,
        camX, camY, panX, panY,
        biome: biome ? biome.name : null, floor: floorInBiome(depth), bossActive,
        grid: { w: MAP_W, h: MAP_H }, fill: genStats,
        hasStairs: map.some((row) => row.includes(STAIRS)),
        monsters: monsters.length,
        mlist: monsters.map((m) => ({ x: m.x, y: m.y, type: m.type, hp: m.hp, maxHp: m.maxHp, level: m.level, ranged: !!m.ranged, charge: !!m.charge, acc: m.acc != null ? m.acc : MON_ACC, eva: m.eva != null ? m.eva : MON_EVA, aware: !!m.aware, dots: m.dots ? m.dots.map((d) => Object.assign({}, d)) : [], stun: m.stun || 0, summoned: !!m.summoned, phased: !!m.phased, beam: m.beam ? { tiles: m.beam.tiles.map((t) => t.slice()) } : null })),
        items: items.map((it) => ({ x: it.x, y: it.y, key: it.key, rarity: it.rarity || null, plus: it.plus || 0, stats: it.stats || null, enchants: it.enchants || null, variant: it.variant || null, vault: !!it.vault })),
        torches: torches.map((t) => ({ x: t.x, y: t.y })),
        traps: traps.map((t) => ({ x: t.x, y: t.y, key: t.key, revealed: !!t.revealed, sprung: !!t.sprung, armed: t.armed || 0 })),
        thorns: (() => { let n = 0; for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (map[y][x] === THORN) n++; return n; })(),
      };
    },
    tileAt: (x, y) => (inBounds(x, y) ? map[y][x] : -1),
    pan: (dxPx, dyPx) => panBy(dxPx, dyPx),
    addXp: (n) => gainXP(n || 0),
    doorOpenAt: (x, y) => doorOpen(x, y),
    visibleAt: (x, y) => (inBounds(x, y) && visible[y] ? !!visible[y][x] : false),
    spawnAt: (type, x, y, hp, level) => {   // dev: drop a monster with custom HP next to you
      if (!VERMIN[type] || !inBounds(x, y)) return false;
      const m = makeMonster(type, x, y);
      if (hp != null) { m.hp = hp; m.maxHp = Math.max(hp, m.maxHp); }
      if (level != null) m.level = level;
      m.aware = true;                        // no surprise multiplier, clean numbers
      monsters.push(m); return true;
    },
    useIdx: (i) => actItem(i),
    step: (dx, dy) => playerAct(dx, dy),
    place: (x, y) => { if (passable(x, y)) { player.x = x; player.y = y; computeFOV(); snapPlayer(); } },
    tap: (x, y) => walkTo(x, y),
    walking: () => walkPath.length,
    tick: () => { if (!dead) worldTurn(); },
    turns: () => turns,
  };

  // A draft from the editor is in play — show a badge so it's obvious, and let the
  // player tap it to drop back to the live (committed) content.
  function showDraftBadge() {
    if (!usingDraft) return;
    const hud = document.getElementById("hud");
    if (!hud) return;
    const b = document.createElement("button");
    b.id = "draftBadge"; b.type = "button"; b.textContent = "⚙ DRAFT";
    b.title = "Playtesting an editor draft — tap to use the live game data";
    b.onclick = () => { try { localStorage.removeItem("cantori_data_override"); } catch (e) {} location.reload(); };
    hud.appendChild(b);
  }

  // ---- Go ------------------------------------------------------------------
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();
  resetPlayer();
  generateLevel();
  updateHUD();
  updateHotbar();
  showDraftBadge();
  requestAnimationFrame(frame);
})();
