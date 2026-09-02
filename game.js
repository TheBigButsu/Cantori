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
  const MAP_W = 47;         // a sprawling floor (~15% less area than the old 51×51)
  const MAP_H = 47;         // joined by narrow, winding 1-wide hallways between chambers
  const FOV_RADIUS = 8;     // max line of sight: you see 8 tiles out (walls/closed
                            // doors block); rooms reveal as you move into them

  const WALL = 0;
  const FLOOR = 1;
  const STAIRS = 2;
  const DOOR = 3;              // hall entrance; passable, but a *closed* door blocks sight
  const THORN = 4;             // bramble barrier: you can push through, but it hurts
  const WATER = 5;             // shallow water — declared for C2/C3, not placed yet
  const CHASM = 6;             // fall-through gap — declared for C2/C3, not placed yet
  const RUBBLE = 7;            // broken stone — declared for C2/C3, not placed yet
  const GRASS = 8;             // tall grass — declared for C2/C3, not placed yet

  // What a tile IS, rather than which constant it equals. Every predicate below reads
  // this table, so a new tile is a row here plus a draw case — not a hunt through the file.
  const TILE = {
    [WALL]:   { solid: true, opaque: true },
    [FLOOR]:  {},
    [STAIRS]: {},
    [DOOR]:   {},                                    // sight handled by doorOpen()
    [THORN]:  { hurts: [5, 10], shun: true, noTravel: true, opaque: true },   // brambles are dense — you cannot see through them, nor they you
    // Deep water: ground movement stops at the shore, only fliers cross. Deliberately
    // NOT `solid` — it isn't a wall. You see across it, arrows fly over it, and the
    // generator may carve through it; it only stops feet.
    [WATER]:  { deep: true, blocksConnect: false },
    [CHASM]:  { falls: true, shun: true, noTravel: true, blocksConnect: true },
    [RUBBLE]: {},                                    // decorative for now — C3 gives it meaning
    [GRASS]:  { conceals: true },
  };
  // Out of bounds is WALL, not "no properties" — otherwise the map edge stops
  // counting as solid and canStep will happily cut a corner around it.
  const tileProp = (x, y, k) => { const p = TILE[inBounds(x, y) ? map[y][x] : WALL]; return p ? p[k] : undefined; };

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
  let turnMeter = 5;           // the top turn-timer bar: 5 turns of banked time, depleted by each action's cost
  let lastActionCost = 1;      // the most recent action's time cost — colors the bar (hasted/slowed)
  let bossName = "";
  const biomeOf = (d) => Math.min(DATA.biomes.length - 1, Math.floor((d - 1) / 5));
  const floorInBiome = (d) => ((d - 1) % 5) + 1;
  const isBossDepth = (d) => floorInBiome(d) === 5;

  // ---- Merchant floor: a peaceful, monster-free floor inserted after every
  // boss kill (doesn't consume a depth number — `depth` stays put while it's
  // visited, so biome/floor math is untouched). A shopkeeper buys gear from
  // your pack and sells 3 auto-restocking potions; a fountain sells a full heal.
  let inShop = false;
  let shopKeeper = null;     // {x, y} — wall-mounted, like a torch
  let fountain = null;       // {x, y} — wall-mounted, like a torch
  let shopStock = [];        // 3 potion keys currently for sale
  let shopHealCost = 0;      // gold cost of the fountain's full heal, fixed for this shop visit
  const SHOP_POTION_PRICE = 20;
  const sellPrice = (inst) => gearTier(inst.key) * 2;

  // Stats → effects (INT / RES / LCK come later)
  const UNARMED_MIN = 2, UNARMED_MAX = 3;
  const HP_BASE = 13, HP_PER_VIT = 1;     // 1 point of VIT = 1 HP (warrior: 13 + VIT ≈ 20)
  const ACC_BASE = 10, EVA_BASE = -3;     // DEX → accuracy & evasion. EVA_BASE tuned so a
  // fresh level-1 warrior (DEX 4, starting light armor +3 eva) evades a baseline monster
  // (MON_ACC 12) about 25% of the time — the spec's "default base player evasion = 25%".
  const MON_ACC = 12, MON_EVA = 4;        // monster defaults when unspecified
  const weaponStrReq = () => (player.weapon && GEAR[player.weapon.key].req ? (GEAR[player.weapon.key].req.STR || 0) : 0);
  const strBonus = () => Math.max(0, Math.floor((eff("STR") - weaponStrReq()) / 4)); // STR vs weapon req → damage
  // Stat requirements (e.g. armor/weapon req.STR) gate whether a piece can be
  // equipped at all — met once every listed stat is at or above its threshold.
  const gearReqUnmet = (inst) => {
    const req = inst && GEAR[inst.key] && GEAR[inst.key].req;
    if (!req) return null;
    for (const stat of Object.keys(req)) if (eff(stat) < req[stat]) return { stat, need: req[stat], have: eff(stat) };
    return null;
  };
  // maxHp = VIT-based health + flat per-level HP from the class's levelUp set
  const computeMaxHp = () => { const cls = DATA.classes[player.cls] || {}; return (cls.baseHp != null ? cls.baseHp : HP_BASE) + eff("VIT") * HP_PER_VIT + (player.lvlHp || 0); };
  // maxMp = INT-based mana (1 point of INT = 1 MP) + flat per-level MP from the class's levelUp set
  const computeMaxMp = () => { const cls = DATA.classes[player.cls] || {}; return (cls.baseMp != null ? cls.baseMp : 0) + eff("INT") + (player.lvlMp || 0); };
  const playerAcc = () => ACC_BASE + eff("DEX") + weaponAccuracy() + (player.lvlAcc || 0) + (player.boonAcc || 0) + passiveMod("acc");  // DEX + weapon + level + skills + boons
  const playerEva = () => EVA_BASE + eff("DEX") + (player.lvlEva || 0) + (player.boonEva || 0) + armorSubEva() + armorEvasion() + passiveMod("eva");     // DEX + level + armor weight/item + skills + boons
  // Critical hits: 5% chance to deal 200% damage by default, each grown by the
  // class's per-level crit / critDmg gains (added, not multiplied), Ourn's
  // Perfectly Timed Blow (+1% per character level), DEX (+1% per point) and
  // LCK (+1% chance per point, +2% crit damage per point).
  const BASE_CRIT = 5, BASE_CRIT_DMG = 200;
  const timedBlowBonus = () => (player.boons && player.boons.has("timed_blow")) ? player.level : 0;
  const critChance = () => (BASE_CRIT + (player.lvlCrit || 0) + timedBlowBonus() + eff("DEX") + eff("LCK")) / 100;
  const critMult = () => (BASE_CRIT_DMG + (player.lvlCritDmg || 0) + eff("LCK") * 2) / 100;
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
    killCount: 0,                                      // per-run kill counter (Compost Pile / Gift / Future Sight / Dilating Pupils / Pride)
    secondChanceUsed: false,                            // Maelon's Second Chance: consumed once
    boonAcc: 0, boonEva: 0, boonHaste: 0,               // permanent flat bonuses from kill-counter boons
    hasteBuff: 0,                                       // temporary % Haste from Speed of Light, decays 1/turn
  };
  const STAT_KEYS = ["STR", "INT", "VIT", "DEX", "RES", "LCK"];
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
    player.lvlHp = 0; player.lvlAcc = 0; player.lvlEva = 0; player.lvlMp = 0;   // reset per-level bonuses
    player.lvlCrit = 0; player.lvlCritDmg = 0;
    player.regenAcc = 0; player.mpRegenAcc = 0;
    identified.clear();
    player.stoneSkin = null;                   // timed buffs don't carry across a new run
    player.healPending = 0;                    // queued heal-over-time from a potion
    player.stun = 0;                           // turns you're dazed (e.g. slammed into a wall) — actions are wasted
    player.boons = new Set();                  // boons are earned fresh each run
    player.killCount = 0; player.secondChanceUsed = false;
    player.boonAcc = 0; player.boonEva = 0; player.boonHaste = 0; player.hasteBuff = 0;
    activeWalls = []; pullZone = null;
    assignPotionLooks();                        // scramble unidentified potion colours for this run
    _skillCache = { cls: null, skills: {}, byId: {} };    // force a rebuild for the new class
    player.skills = {};
    const sk = treeSkills(key).skills;
    for (const k of Object.keys(sk)) player.skills[k] = { rank: 0, cd: 0 };
    if (c.start) {                             // starting kit (plain white), already equipped
      if (c.start.weapon && GEAR[c.start.weapon]) player.weapon = mkBase(c.start.weapon);
      if (c.start.armor && GEAR[c.start.armor]) player.armor = mkBase(c.start.armor);
    }
    player.maxHp = computeMaxHp();             // after gear, so VIT affixes count
    player.hp = player.maxHp;
    player.maxMp = computeMaxMp();             // after gear, so INT affixes/quality bonuses count
    player.mp = player.maxMp;
  }
  function resetPlayer() { applyClass(player.cls || "warrior"); }
  let monsters = [];
  let items = [];
  let traps = [];
  let walkPath = [];
  let activeWalls = [];   // Kethara's Wall of Faith: temporary wall tiles awaiting reversion
  let pullZone = null;    // Kethara's Faith's Pull: { x, y, turns } — pulls monster pathing to its center
  let biomeScrollFloors = null;   // Set of 2 floor-in-biome numbers (1-5) that guarantee a Scroll of Upgrade this biome
  let bossRoom = null;            // the room the current floor's boss occupies (its exit opens on the nearest wall, not the death tile)
  const trapAt = (x, y) => traps.find((t) => t.x === x && t.y === y) || null;

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const isWall = (x, y) => !inBounds(x, y) || map[y][x] === WALL;
  const isDoor = (x, y) => inBounds(x, y) && map[y][x] === DOOR;
  const isThorn = (x, y) => inBounds(x, y) && map[y][x] === THORN;
  const shuns = (x, y) => !!tileProp(x, y, "shun");     // monsters (and drops/teleports) avoid these tiles
  // Walkable on foot. Deep water counts as blocked here, which is what makes every
  // spawn, drop, knockback and auto-travel route dodge it without a special case.
  // Anything that flies asks canStep/passableFor instead.
  const passable = (x, y) => inBounds(x, y) && !tileProp(x, y, "solid") && !tileProp(x, y, "deep");
  // Same question, asked on behalf of a specific mover: fliers cross deep water.
  // (Chasms stay off-limits to everything — they're `shun` + `falls`, not `deep`.)
  const passableFor = (mover, x, y) =>
    inBounds(x, y) && !tileProp(x, y, "solid") && (!tileProp(x, y, "deep") || !!(mover && mover.flying));
  // A door is open while you OR a live monster stands on it, then swings/grows shut
  // behind whoever left — an open/close mechanism (the forest bushes "come back").
  // Without the monster check, something crossing a bush while you watch would slide
  // through the fully-closed sprite with no reaction, and vision would stay blocked
  // at that tile even though you can plainly see whatever is standing right on it.
  // EXCEPT: a door a monster died on is propped open for good (you already fought
  // there, no more ambush to spring) — until you walk back over that exact tile,
  // which resets it to the normal close-behind-you cycle.
  let propOpenDoors = new Set();   // "y*MAP_W+x" keys, reset every new level
  const doorOpen = (x, y) => (player.x === x && player.y === y) || propOpenDoors.has(y * MAP_W + x) || !!monsterAt(x, y);
  const propDoorOpenAt = (x, y) => { if (inBounds(x, y) && map[y][x] === DOOR) propOpenDoors.add(y * MAP_W + x); };
  // Sight (FOV + line of sight) is blocked by walls and by *closed* doors — so a
  // room stays hidden until you reach its doorway, enabling surprise ambushes.
  const blocksSight = (x, y) => !inBounds(x, y) || tileProp(x, y, "opaque") || (map[y][x] === DOOR && !doorOpen(x, y));

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

  // Guild's Blessing: White drop% falls by 1 per character level, redistributed
  // equally across Green/Blue/Purple (Gold untouched). Returns null (pure, unmodified
  // roll) unless the boon is owned — loot.js falls back to its default table then.
  function guildBlessingWeights() {
    if (!(player.boons && player.boons.has("blessing"))) return null;
    const w = {};
    for (const r of LOOT.rarities) w[r.key] = Math.max(0, r.chance);
    const reduction = Math.min(w.white || 0, player.level / 100);
    w.white = Math.max(0, (w.white || 0) - reduction);
    const targets = ["green", "blue", "purple"].filter((k) => w[k] != null);
    if (targets.length && reduction > 0) { const share = reduction / targets.length; for (const k of targets) w[k] = (w[k] || 0) + share; }
    return w;
  }
  // Guild's Refinement: doubles the max +X a drop can roll, and weights toward the
  // higher end (best of two uniform rolls). Returns null (pure roll) if not owned.
  function guildPlusRoll(floor) {
    if (!(player.boons && player.boons.has("refinement"))) return null;
    const maxP = Math.ceil((floor || 1) / 5) * 2;
    return Math.max(randInt(0, maxP), randInt(0, maxP));
  }
  // Roll logic lives in loot.js (a self-contained module) — wire it up here.
  const _loot = window.CantoriLoot({
    GEAR, GEAR_KEYS, LOOT, randInt: (lo, hi) => randInt(lo, hi),
    getRarityWeights: () => guildBlessingWeights(),
    rollPlus: (floor) => guildPlusRoll(floor),
  });
  const rollRarity = _loot.rollRarity;
  const maxPlusForFloor = _loot.maxPlusForFloor;
  const rollItem = _loot.rollItem;
  const rollGearDrop = _loot.rollGearDrop;
  const rollTrinket = _loot.rollTrinket;

  // A plain, already-known base item (starting kit, gold/authored items).
  const mkBase = (key) => ({ key, rarity: "white", plus: 0, stats: [], enchants: [], idNeed: 0, idXp: 0, identified: true });
  // Copy an item instance without its map position (for pack/equip moves).
  function stripPos(it) { const o = Object.assign({}, it); delete o.x; delete o.y; delete o.amount; return o; }

  // Effective numbers for an instance (base + plus). A weapon/armor's +X scales
  // with its tier: min rises by (tier-1) per point, max by tier*2 per point — so
  // a tier-1 item's +1 is worth +0~2 and a tier-2 item's +1 is worth +1~4.
  const gearTier = (key) => GEAR[key].tier || 1;
  const gDmgMin = (inst) => (GEAR[inst.key].dmgMin || 0) + (gearTier(inst.key) - 1) * (inst.plus || 0);
  const gDmgMax = (inst) => (GEAR[inst.key].dmgMax || 0) + gearTier(inst.key) * 2 * (inst.plus || 0);
  // Armor blocks a random amount each hit, rolled between defMin and defMax. A
  // legacy flat `def` still works — it becomes both ends of the range. Its +X
  // scales the same way as weapon damage, by tier.
  const baseDefMin = (key) => { const g = GEAR[key]; return g.defMin != null ? g.defMin : (g.def || 0); };
  const baseDefMax = (key) => { const g = GEAR[key]; return g.defMax != null ? g.defMax : (g.def != null ? g.def : (g.defMin || 0)); };
  const gDefMin = (inst) => baseDefMin(inst.key) + (gearTier(inst.key) - 1) * (inst.plus || 0);
  const gDefMax = (inst) => baseDefMax(inst.key) + gearTier(inst.key) * 2 * (inst.plus || 0);
  const gDef = (inst) => gDefMax(inst);   // top-end block (enchant power, parallels weapon dmgMax)
  // A stat affix's +X is additive-triangular: +1 = 1, +2 = 1+2 = 3, +3 = 1+2+3 = 6…
  const triangular = (n) => (n * (n + 1)) / 2;
  const gStatBonus = (inst, statKey) => {
    let n = 0;
    for (const s of inst.stats || []) if (s.stat === statKey) n += s.val + triangular(inst.plus || 0);
    return n;
  };
  // Sum a stat bonus across every equipped item (weapon, armor, rings, trinket, necklace).
  function equipStat(statKey) {
    let n = 0;
    for (const it of wornItems()) n += gStatBonus(it, statKey);
    return n;
  }
  // Rarity → quality multiplier used by the Guild's Scribe's Intellect / Blacksmith's
  // Arm boons: INT (or STR) rises with your gear's total upgrades weighted by quality.
  const QUALITY_MULT = { white: 1.0, green: 1.5, blue: 2.0, purple: 3.0, gold: 5.0 };
  const roundHalf = (n) => Math.round(n * 2) / 2;
  function guildQualityBonus() {
    let total = 0;
    for (const it of wornItems()) { if (it.plus) total += it.plus * (QUALITY_MULT[it.rarity] || 1.0); }
    return roundHalf(total);
  }
  const eff = (statKey) => {
    let v = player.stats[statKey] + equipStat(statKey);   // base + gear
    if (player.boons) {
      if (statKey === "INT" && player.boons.has("scribe")) v += guildQualityBonus();
      if (statKey === "STR" && player.boons.has("blacksmith")) v += guildQualityBonus();
    }
    return v;
  };
  // An enchant effect's tiered value for the item bearing it (its gear def's own
  // tier, clamped into the tierValues range — untiered starter gear reads as
  // tier 1), falling back to a flat legacy field for enchants authored without
  // tierValues. tierValues lives on the enchant definition itself (a sibling of
  // `effect`), matching the editor's own "+ Add enchant" template shape.
  function enchantTierValue(def, it, fallback) {
    const tv = def && def.tierValues;
    if (Array.isArray(tv) && tv.length) {
      const t = Math.min(tv.length, Math.max(1, (it && GEAR[it.key] && gearTier(it.key)) || 1));
      return tv[t - 1];
    }
    return fallback;
  }
  // Extra flat mitigation from "Defense" enchants worn on armor / jewelry —
  // tiered by the item bearing the enchant, added to both min and max block.
  function wornDefense() {
    let d = 0;
    for (const it of wornItems()) {
      if (!it || !it.enchants) continue;
      for (const e of it.enchants) {
        const def = LOOT.enchants[e];
        if (def && def.effect && def.effect.type === "defense") d += enchantTierValue(def, it, def.effect.amount || 0);
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
  // Weapon combat numbers (unarmed falls back to the base 2–3 fists, boosted by
  // Brynn's Unarmed Master passive when no weapon is equipped).
  const weaponDmgMin = () => (player.weapon ? gDmgMin(player.weapon) : player.atkMin + passiveMod("dmgMin") + unarmedStatBonus());
  const weaponDmgMax = () => (player.weapon ? gDmgMax(player.weapon) : player.atkMax + passiveMod("dmgMax") + unarmedStatBonus());
  const weaponAccuracy = () => (player.weapon ? (GEAR[player.weapon.key].accuracy || 0) : 0);
  const weaponSpeed = () => { if (!player.weapon) { const s = passiveMod("speed"); if (s) return s; } return player.weapon ? (GEAR[player.weapon.key].speed || 1) : 1; };
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
  // A worn armor piece's own evasion stat (on top of the flat subtype bonus above).
  const armorEvasion = () => (player.armor ? (GEAR[player.armor.key].evasion || 0) : 0);
  // Passive "haste" from worn Speed enchants — makes your attacks cost less time,
  // tiered by the item bearing the enchant.
  function wornHaste() {
    let h = 0;
    for (const it of wornItems()) {
      if (!it || !it.enchants) continue;
      for (const e of it.enchants) {
        const def = LOOT.enchants[e];
        // Speed's tierValues are the item's own total speed multiplier (e.g. 1.1 =
        // ×1.1, tier5's 1.8 = ×1.8 alone) — converted to the additive fraction this
        // formula stacks, so a single tier-N item lands on exactly that multiplier
        // while still combining normally with other worn items and haste buffs.
        if (def && def.effect && def.effect.type === "haste") h += enchantTierValue(def, it, 1 + (def.effect.mult || 0)) - 1;
      }
    }
    h += (player.boonHaste || 0) / 100;    // Ourn's Dilating Pupils: permanent +1%/5 kills
    h += (player.hasteBuff || 0) / 100;    // Ourn's Speed of Light: temporary, decaying buff
    return h;
  }
  const playerActSpeed = () => weaponSpeed() * (1 + wornHaste());
  // The Metrognome trinket: a worn one grants +1 to EITHER walk speed or attack
  // speed (its rolled variant), never both. Lower action-cost = you act more often
  // relative to monsters.
  const metroMode = () => (player.trinket && player.trinket.key === "metrognome" ? player.trinket.variant : null);
  // Haste speeds up the two things you do in a fight: walking and swinging. It used
  // to reach the swing only, which left Ourn's whole tree unable to move you a single
  // tile sooner — Dilating Pupils, and a Speed of Light that promises the world slows
  // around you, bought no kiting, no disengage, no running anything down. Walking is
  // the action you take most, so haste that skips it isn't speed, it's attack speed.
  // Weapon speed deliberately stays OUT of the walk: a heavy axe slows your swing,
  // not your feet. That's the same split the Metrognome already draws between its two
  // variants, and the two now stack the same additive way on both sides.
  // Everything else — a potion, a scroll, equipping, a skill — remains a flat turn, so
  // consumables still cost real tempo no matter how fast you are.
  const walkCost = () => 1 / (1 + wornHaste() + (metroMode() === "walk" ? 1 : 0));
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
  // The merchant's stock: any potion except Potion of Insight (that one's earned,
  // never bought), same weight-honouring pick as floor loot.
  function weightedShopPotionKey() {
    const pool = CONSUM_KEYS.filter((k) => CONSUM[k].cat === "potion" && k !== "skill_point");
    if (!pool.length) return null;
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
    // A few extra loops for alternate routes — kept sparse so hallways don't pile
    // up on each other into a wide blob where several rooms cluster together.
    for (let a = 0; a < rooms.length; a++) {
      if (Math.random() > 0.15) continue;
      let nb = -1, nd = Infinity;
      for (let b = 0; b < rooms.length; b++) { if (b === a) continue; const d = manh(a, b); if (d < nd) { nd = d; nb = b; } }
      if (nb >= 0) carveCorridor(cen[a], cen[nb]);
    }
  }
  // Post-connection cleanup: where several rooms cluster close together, their
  // separate 1-wide hallway paths (MST edges + the extra loops above) can thread
  // through the same small region and merge into a wide, blobby open area rather
  // than reading as proper halls. Thin any corridor floor tile with 3+ orthogonal
  // floor neighbours back to wall, one at a time, reverting if that would
  // disconnect any room — same tentative-apply/revert pattern as narrowRoomBreaches.
  function thinCorridors(rooms) {
    if (!rooms.length) return;
    const anchor = roomCenter(rooms[0]);
    const inRoom = (x, y) => rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let y = 1; y < MAP_H - 1; y++) {
        for (let x = 1; x < MAP_W - 1; x++) {
          if (map[y][x] !== FLOOR || inRoom(x, y)) continue;
          const n4 = (map[y - 1][x] === FLOOR ? 1 : 0) + (map[y + 1][x] === FLOOR ? 1 : 0) +
                     (map[y][x - 1] === FLOOR ? 1 : 0) + (map[y][x + 1] === FLOOR ? 1 : 0);
          if (n4 < 3) continue;
          map[y][x] = WALL;
          if (allRoomsReachable(rooms, anchor.x, anchor.y)) changed = true;
          else map[y][x] = FLOOR;   // load-bearing, keep it
        }
      }
      if (!changed) break;
    }
  }
  // A room-boundary breach whose far side goes nowhere further (a single dead
  // 1-tile stub) invites exploration through a doorway that then dead-ends
  // immediately. Wall the breach itself back up (even if a door already sits
  // there — better no door than a fake one) whenever this happens; only
  // reverts if that would somehow disconnect a room (a true dead end never
  // carries connectivity, so this is belt-and-suspenders). Called once before
  // doors are placed, then again after narrowRoomBreaches/fixOpenCorners —
  // those later passes can themselves wall off the one branch that had kept
  // an already-checked breach from reading as dead.
  function sealDeadEndStubs(rooms) {
    if (!rooms.length) return;
    const anchor = roomCenter(rooms[0]);
    const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const isOpen = (x, y) => inBounds(x, y) && (map[y][x] === FLOOR || map[y][x] === DOOR || map[y][x] === STAIRS);
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const r of rooms) {
        const inRoom = (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
        for (const [x, y] of roomRing(r)) {
          if (!inBounds(x, y) || (map[y][x] !== FLOOR && map[y][x] !== DOOR)) continue;
          for (const [dx, dy] of DIR4) {
            const nx = x + dx, ny = y + dy;
            if (inRoom(nx, ny) || !isOpen(nx, ny)) continue;   // only the outward side, if open
            const branches = DIR4.some(([dx2, dy2]) => {
              const bx = nx + dx2, by = ny + dy2;
              return !(bx === x && by === y) && isOpen(bx, by);
            });
            if (branches) continue;   // leads somewhere — leave it
            const was = map[y][x];
            map[y][x] = WALL;
            if (allRoomsReachable(rooms, anchor.x, anchor.y)) changed = true;
            else map[y][x] = was;   // load-bearing, keep it
          }
        }
      }
      if (!changed) break;
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
        if (passable(x, y) && !shuns(x, y) && !monsterAt(x, y) && !(x === player.x && y === player.y)) {
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
  // After placeDoors, a corridor (or an attached-room seam) can touch a room's
  // ring at more than one adjacent tile — placeDoors' "no two doors touching"
  // rule only turns one of them into a door, leaving the rest as plain,
  // undoored floor right beside it (a hallway entrance that visually has no
  // door plugging it). Narrow every such multi-tile breach down to its one
  // door, walling off the extra floor — but only where that never disconnects
  // the map (a tile that's load-bearing for some other corridor is left alone).
  function narrowRoomBreaches(rooms) {
    if (!rooms.length) return;
    const anchor = roomCenter(rooms[0]);
    for (const r of rooms) {
      const ringFloor = roomRing(r).filter(([x, y]) => inBounds(x, y) && (map[y][x] === FLOOR || map[y][x] === DOOR));
      const used = new Set();
      for (const [x, y] of ringFloor) {
        const key = x + "," + y;
        if (used.has(key)) continue;
        const cluster = [[x, y]]; used.add(key);
        let head = 0;
        while (head < cluster.length) {
          const [cx, cy] = cluster[head++];
          for (const [ox, oy] of ringFloor) {
            const ok = ox + "," + oy;
            if (used.has(ok)) continue;
            if (Math.max(Math.abs(ox - cx), Math.abs(oy - cy)) <= 1) { used.add(ok); cluster.push([ox, oy]); }
          }
        }
        if (cluster.length < 2 || !cluster.some(([cx, cy]) => map[cy][cx] === DOOR)) continue;
        for (const [cx, cy] of cluster) {
          if (map[cy][cx] !== FLOOR) continue;   // leave doors alone, only close plain floor
          if ((cx === player.x && cy === player.y) || monsterAt(cx, cy) || itemAt(cx, cy)) continue;
          map[cy][cx] = WALL;
          if (!allRoomsReachable(rooms, anchor.x, anchor.y)) map[cy][cx] = FLOOR;   // revert if load-bearing
        }
      }
    }
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
    // `passable` already rejects walls and deep water; blocksConnect is for tiles that
    // are technically enterable but must never count as a route (a chasm you fall into).
    const blocked = (x, y) => !passable(x, y) || tileProp(x, y, "blocksConnect") || (blockThorns && tileProp(x, y, "hurts"));
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
  // Post-generation constraint: eliminate "open diagonal corners" — a 2×2 block
  // where the wall pair and the floor pair each touch only at a single point
  // (a checkerboard corner). Movement already treats this shape as blocked (see
  // canStep's corner-cut rule), but nothing stopped the shadowcast FOV from
  // peeking diagonally through the same gap — a see-through-the-wall mismatch.
  // Fixing it at generation time (rather than patching the FOV algorithm) keeps
  // "can I see it" and "can I walk to it" consistent everywhere.
  function allRoomsReachable(rooms, sx, sy) {
    const reach = floodReach(sx, sy, false);
    return rooms.every((r) => {
      const c = roomCenter(r);
      if (reach.has(c.y * MAP_W + c.x)) return true;
      // The centre tile itself may be one you can't stand on — a pond in the middle of
      // the room. The room is still perfectly reachable; ask whether ANY of it is
      // before condemning the floor. (Only runs when the centre misses, so the common
      // case stays a single Set lookup.)
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++)
          if (reach.has(y * MAP_W + x)) return true;
      return false;
    });
  }
  function fixOpenCorners(rooms) {
    if (!rooms.length) return;
    const anchor = roomCenter(rooms[0]);
    const solid = (x, y) => !inBounds(x, y) || map[y][x] === WALL;
    // A local fix can create (or reveal) a new open corner in an adjacent 2×2
    // block that an earlier pass already scanned past, so sweep to a fixed
    // point — repeat full passes until one makes no changes (capped for safety).
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (let y = 0; y < MAP_H - 1; y++) {
        for (let x = 0; x < MAP_W - 1; x++) {
          const a = solid(x, y), b = solid(x + 1, y), c = solid(x, y + 1), d = solid(x + 1, y + 1);
          let openCells;
          if (a && d && !b && !c) openCells = [[x + 1, y], [x, y + 1]];        // wall NW/SE, floor NE/SW
          else if (b && c && !a && !d) openCells = [[x, y], [x + 1, y + 1]];   // wall NE/SW, floor NW/SE
          else continue;
          // Prefer solidifying one of the two open (floor) cells — whichever keeps
          // every room reachable. If neither is safe (both load-bearing), fall back
          // to opening one of the wall cells instead — always connectivity-safe.
          let fixed = false;
          for (const [ox, oy] of openCells) {
            if (map[oy][ox] !== FLOOR) continue;   // never wall over a door threshold
            if ((ox === player.x && oy === player.y) || monsterAt(ox, oy) || itemAt(ox, oy)) continue;  // never bury an occupant
            map[oy][ox] = WALL;
            if (allRoomsReachable(rooms, anchor.x, anchor.y)) { fixed = true; break; }
            map[oy][ox] = FLOOR;
          }
          if (!fixed) {
            const wallCells = a && d ? [[x, y], [x + 1, y + 1]] : [[x + 1, y], [x, y + 1]];
            map[wallCells[0][1]][wallCells[0][0]] = FLOOR;
          }
          changed = true;
        }
      }
      if (!changed) break;
    }
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

  // Biome-specific terrain (C2): grows an organic blob of `tile`, up to `size` tiles,
  // outward from a seed floor tile — a randomized flood fill so the shape reads as
  // natural rather than a rectangle. Never touches a cell `skip` rejects or anything
  // that isn't plain FLOOR (so it can't overwrite another painter's work, and — since
  // this runs before doors/stairs/thorns/trees exist — there's nothing else on the map
  // to protect yet).
  function paintTerrainBlob(tile, x0, y0, size, skip) {
    const seen = new Set([y0 * MAP_W + x0]);
    const frontier = [[x0, y0]];
    const cells = [];
    while (cells.length < size && frontier.length) {
      const [x, y] = frontier.splice(randInt(0, frontier.length - 1), 1)[0];
      if (map[y][x] !== FLOOR || skip(x, y)) continue;
      map[y][x] = tile; cells.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ny * MAP_W + nx;
        if (!inBounds(nx, ny) || seen.has(k)) continue;
        seen.add(k);
        if (map[ny][nx] === FLOOR && !skip(nx, ny)) frontier.push([nx, ny]);
      }
    }
    return cells;
  }
  // Scatter `cfg[countKey]` blobs of `tile` (a [min,max] roll each), each sized from
  // `cfg.size` (default a small patch), seeded on random floor tiles across the level.
  // `keep` vets a finished blob (see paintTerrain's connectivity check) and, when it
  // says no, that blob alone is undone — the rest of the level keeps its terrain.
  function paintTerrainFeature(tile, cfg, countKey, skip, keep) {
    if (!cfg || !cfg[countKey]) return [];
    const n = randInt(cfg[countKey][0], cfg[countKey][1]);
    const size = cfg.size || [3, 6];
    const seeds = [];
    const painted = [];
    for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) if (map[y][x] === FLOOR && !skip(x, y)) seeds.push([x, y]);
    for (let i = 0; i < n && seeds.length; i++) {
      const [x, y] = seeds[randInt(0, seeds.length - 1)];
      const cells = paintTerrainBlob(tile, x, y, randInt(size[0], size[1]), skip);
      if (keep && !keep()) { for (const [cx, cy] of cells) map[cy][cx] = FLOOR; continue; }
      for (const c of cells) painted.push(c);
    }
    return painted;
  }
  // Every cell this level's painters coloured in, so a late failure can undo exactly
  // those and nothing else — see unpaintTerrain.
  let paintedCells = [];
  // Undo the terrain paint, cell by cell. Deliberately NOT a whole-grid snapshot
  // restore: doors, stairs, thorn vaults and trees are written to the map *after*
  // painting, and rolling the grid back would erase them. A cell that has since
  // become something else is left alone. Turning water back into floor only ever
  // adds passability, so this is safe to call at any point in generation.
  function unpaintTerrain(tiles) {
    for (const [x, y, t] of paintedCells) if (map[y][x] === t && (!tiles || tiles.indexOf(t) >= 0)) map[y][x] = FLOOR;
    paintedCells = tiles ? paintedCells.filter(([, , t]) => tiles.indexOf(t) < 0) : [];
  }
  // Paint the current biome's water/grass/rubble onto the room+corridor graph,
  // driven from data.js → biomes[].terrain. A biome with no `terrain` block is a
  // no-op, so it generates exactly as it did before this painter existed. Runs after
  // thinCorridors/sealDeadEndStubs (the graph is settled) and before placeDoors (so
  // there's nothing walkable placed yet to dodge).
  //
  // Deep water blocks movement, so a pool can sever a floor the way a wall would.
  // Guard it twice: each blob is vetted the moment it lands, and any that costs the
  // level a tile it could previously walk to is undone on the spot (a pool that
  // reaches a corridor wall, or rings an alcove). Then the whole paint is re-checked
  // room by room. Grass and rubble can't sever anything, but they go through the
  // same path — one code path is cheaper to keep honest than two.
  function paintTerrain(rooms) {
    paintedCells = [];
    const terrain = biome && biome.terrain;
    if (!terrain || !rooms.length) return;
    const anchor = roomCenter(rooms[0]);          // becomes the player's start tile right after this runs
    const skip = (x, y) => x === anchor.x && y === anchor.y;
    const before = floodReach(anchor.x, anchor.y, false);
    // Every tile walkable before painting must still be walkable, or still be
    // reachable — a tile that became water is fine, a tile stranded behind it is not.
    const keep = () => {
      const after = floodReach(anchor.x, anchor.y, false);
      for (const k of before) {
        if (after.has(k)) continue;
        if (!passable(k % MAP_W, Math.floor(k / MAP_W))) continue;   // it IS the water now
        return false;
      }
      return true;
    };
    const record = (tile, cells) => { for (const [x, y] of cells) paintedCells.push([x, y, tile]); };
    // Water keeps clear of walls entirely: a pool that touches one can plug a corridor
    // or seal a doorway, and `keep` would then throw the whole blob away — which is why
    // an unrestricted painter left most floors dry. Confined to open ground it grows
    // into a pond with a walkable shore all the way round, which cannot sever anything
    // and reads as deliberate. At this point in generation the map is only FLOOR and
    // WALL, so "not next to a wall" is the whole test.
    const nearWall = (x, y) => DIRS8.some(([dx, dy]) => !inBounds(x + dx, y + dy) || map[y + dy][x + dx] === WALL);
    if (terrain.water) record(WATER, paintTerrainFeature(WATER, terrain.water, "pools", (x, y) => skip(x, y) || nearWall(x, y), keep));
    if (terrain.grass) record(GRASS, paintTerrainFeature(GRASS, terrain.grass, "patches", skip, keep));
    if (terrain.rubble) record(RUBBLE, paintTerrainFeature(RUBBLE, terrain.rubble, "patches", skip, keep));
    fixOpenCorners(rooms);
    if (!allRoomsReachable(rooms, anchor.x, anchor.y)) unpaintTerrain();   // never ship a severed floor
  }

  function generateLevel() {
    map = blankGrid(WALL);
    explored = blankGrid(false);
    beenSeen = blankGrid(false);
    visible = blankGrid(false);
    torches = [];
    propOpenDoors = new Set();
    walkPath = [];
    monsters = [];
    items = [];
    traps = [];
    turns = 0;

    const rooms = [];
    const attachEdges = [];   // [roomIdx, partnerIdx, doorTile] for attached rooms (doorway, no hall)
    // Boss floors get bigger, more open "arena" chambers and much more total
    // room area relative to hallway — the fight (and the boon-choice drop
    // after it) should read as open room combat, not a corridor skirmish.
    const bossFloor = isBossDepth(depth);
    // Keep the TOTAL room area about the same as before — the same chambers spread
    // across a big floor, joined by 1-wide winding hallways (or a shared doorway).
    const roomTarget = bossFloor ? 620 : 290;   // ~15% less than the old 340, matching the smaller map
    let roomArea = 0, guard = 0;
    while (roomArea < roomTarget && rooms.length < 16 && guard++ < 900) {
      // Varied aspect ratios (often tall or wide) so rooms don't all read as squares,
      // but kept to the familiar chamber size (~24–60 tiles) — bigger, arena-scale
      // on a boss floor.
      let w, h;
      if (bossFloor) { w = randInt(9, 14); h = randInt(8, 12); } else { w = randInt(5, 9); h = randInt(4, 8); }
      if (Math.random() < 0.4) { const t = w; w = h; h = t; }
      if (w * h > (bossFloor ? 170 : 60)) continue;
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
    thinCorridors(rooms);   // narrow any hallway blob left by overlapping/converging paths
    sealDeadEndStubs(rooms);   // no doorway should invite exploration into a 1-tile dead end
    lastRooms = rooms; lastAttach = attachEdges.length;

    biomeIndex = biomeOf(depth);
    biome = DATA.biomes[biomeIndex];
    // Exactly 2 Scrolls of Upgrade guaranteed per biome (not per floor): pick 2 of
    // its 5 floors, once, the first time we see this biome — re-rolled on entering
    // the next one.
    if (floorInBiome(depth) === 1 || !biomeScrollFloors) {
      const floors = [1, 2, 3, 4, 5];
      for (let i = floors.length - 1; i > 0; i--) { const j = randInt(0, i); const t = floors[i]; floors[i] = floors[j]; floors[j] = t; }
      biomeScrollFloors = new Set(floors.slice(0, 2));
    }

    paintTerrain(rooms);   // biome-specific water/grass/rubble (C2) — no-op without a terrain block

    placeDoors(rooms);
    narrowRoomBreaches(rooms);   // one door per breach — close any extra undoored floor beside it
    sealDeadEndStubs(rooms);   // re-check: narrowRoomBreaches can itself wall off a door's only branch
    fixOpenCorners(rooms);   // no diagonal-only wall/floor touches — keeps sight & movement consistent

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
      bossRoom = last;
      spawnBoss(last);
    } else {
      bossActive = false;
      bossRoom = null;
      placeExit(rooms, last);
      spawnMonsters(rooms);
    }
    spawnItems(rooms);
    placeTrees(rooms, restricted);                     // obstacle trees in the larger rooms
    fixOpenCorners(rooms);   // trees are wall tiles too — re-sweep for any new diagonal touches
    // Last line of defence (CLAUDE.md rule 5). Deep water blocks movement, and doors,
    // thorn vaults and trees all land AFTER the terrain paint — so a pool that was
    // harmless when painted can still end up sealing the way onward once a tree drops
    // beside it. If the way onward isn't walkable from the start tile, take the terrain
    // back out: turning water into floor only ever opens routes, and a plain floor
    // beats an unfinishable one.
    if (paintedCells.length) {
      const goal = bossActive ? (monsters.find((m) => DATA.bosses[m.type]) || monsters[0]) : findStairs();
      const reach = floodReach(player.x, player.y, false);
      if (!goal || !reach.has(goal.y * MAP_W + goal.x)) unpaintTerrain();
    }
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
    _boss.reset();
    screenFlash = null;
    snapPlayer();
    updateHUD();       // vitals + enemy counter reflect the new floor at once
  }

  // A small, single-room, monster-free floor: no fight, just a shopkeeper and a
  // fountain built into the walls (exactly like a torch bracket) and stairs
  // onward. `depth`/`biome` are left untouched by the caller, so this floor
  // still reads (and renders) as belonging to the biome just cleared.
  function generateShopLevel() {
    map = blankGrid(WALL);
    explored = blankGrid(false);
    beenSeen = blankGrid(false);
    visible = blankGrid(false);
    torches = [];
    propOpenDoors = new Set();
    walkPath = [];
    monsters = [];
    items = [];
    traps = [];
    turns = 0;
    bossActive = false;
    bossRoom = null;

    const w = 15, h = 9;
    const x = Math.floor((MAP_W - w) / 2), y = Math.floor((MAP_H - h) / 2);
    const room = { x, y, w, h };
    carveRoom(room);
    lastRooms = [room]; lastAttach = 0;

    player.x = x + 1;
    player.y = y + Math.floor(h / 2);
    map[y + Math.floor(h / 2)][x + w - 2] = STAIRS;
    shopKeeper = { x: x + 4, y: y - 1 };
    fountain = { x: x + w - 5, y: y - 1 };
    shopStock = [weightedShopPotionKey(), weightedShopPotionKey(), weightedShopPotionKey()];
    shopHealCost = (biomeOf(depth) + 1) * 20;

    genStats = computeFill([room]);
    computeFOV();
    setDepthLabel();
    floaters = [];
    speeches = [];
    projectiles = [];
    bursts = [];
    streaks = [];
    spirals = [];
    _boss.reset();
    screenFlash = null;
    snapPlayer();
    updateHUD();
  }

  // ---- Monster & boss factories -------------------------------------------
  function makeMonster(type, x, y) {
    // copy the whole template so ability flags (evasion/charge/ranged/range) carry over
    return Object.assign({}, VERMIN[type], {
      x, y, type, boss: false, hp: VERMIN[type].hp, maxHp: VERMIN[type].hp, level: depth,
    });
  }
  function makeBoss(key, x, y) {
    // spread the whole row so authored fields (speed, acc, eva, ranged, range,
    // anything a playbook wants) survive — the way makeMonster copies VERMIN
    const b = DATA.bosses[key];
    return Object.assign({}, b, {
      x, y, type: key, boss: true, glyph: "@", color: "#f0a838", level: depth, hp: b.hp, maxHp: b.hp,
    });
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
        const b = makeBoss(key, x, y);
        monsters.push(b);
        _boss.onSpawn(b);
        placed++;
      }
    }
    if (placed === 0) { const b = makeBoss(key, cx, cy); monsters.push(b); _boss.onSpawn(b); }
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
    // Exactly 2 Scrolls of Upgrade guaranteed per biome, on 2 of its 5 floors
    // (picked in generateLevel) — also noDrop, so this is their only natural source.
    if (biomeScrollFloors && biomeScrollFloors.has(floorInBiome(depth))) {
      const su = freeFloorSpot(rooms);
      if (su) items.push({ x: su.x, y: su.y, key: "scroll_upgrade" });
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
      const mk = pickMonster(); if (mk) monsters.push(makeMonster(mk, x, y));
    }
  }

  // Place the level exit. "wall" style carves a gap in the border trees at the
  // edge of the last clearing (a path onward); otherwise it's stairs in a room.
  // The exit always sits embedded in a wall — like a proper archway, never
  // standing alone in open floor and never punched through a wall so thin
  // that it's floor on both sides (a corridor right behind it). Scan a room's
  // boundary ring (corners excluded) for a wall tile that's ALSO flanked by
  // wall on both its perpendicular sides — a real wall FACE, not just a
  // single wall pixel. Prefers `room` (the intended host); if that room has
  // no such spot at all (its whole perimeter shared via doors/attachments),
  // tries every other room, closest-generated-to-`room` first, before ever
  // falling back to just standing it in the room's open center.
  const findStairs = () => { for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (map[y][x] === STAIRS) return { x, y }; return null; };
  function placeExit(rooms, room) {
    const flankedSpots = (r) => {
      const ring = roomRing(r).filter(([x, y]) => inBounds(x, y) && map[y][x] === WALL);
      return ring.filter(([x, y]) => {
        // North/south edge (y outside the room) → flank left/right; east/west edge → flank up/down.
        const horiz = y < r.y || y >= r.y + r.h;
        const [fax, fay] = horiz ? [x - 1, y] : [x, y - 1];
        const [fbx, fby] = horiz ? [x + 1, y] : [x, y + 1];
        return inBounds(fax, fay) && map[fay][fax] === WALL && inBounds(fbx, fby) && map[fby][fbx] === WALL;
      });
    };
    const pick = (arr) => arr[randInt(0, arr.length - 1)];
    // A spot is only usable if you can actually stand next to it. Since terrain is
    // painted before this runs, a ring tile whose whole inward side is deep water
    // would open onto a pond — carve the stairs somewhere you can walk to instead.
    const standable = ([x, y]) => DIRS8.some(([dx, dy]) => passable(x + dx, y + dy));
    const order = [room].concat(rooms.filter((r) => r !== room).slice().reverse());
    for (const r of order) {
      const flanked = flankedSpots(r).filter(standable);
      if (flanked.length) { const [x, y] = pick(flanked); map[y][x] = STAIRS; return; }
    }
    for (const r of order) {
      const ring = roomRing(r).filter(([x, y]) => inBounds(x, y) && map[y][x] === WALL).filter(standable);
      if (ring.length) { const [x, y] = pick(ring); map[y][x] = STAIRS; return; }
    }
    // Absolute last resort — every room's whole perimeter is shared (doors/attachments).
    map[Math.floor(room.y + room.h / 2)][Math.floor(room.x + room.w / 2)] = STAIRS;
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
    // Stepping onto a door/bush resets any "propped open" state from a kill —
    // this runs on every FOV recompute, i.e. every time the player's position
    // actually changes, so the reset can't be missed by relying on some other
    // incidental doorOpen() query landing on this exact tile.
    if (map[player.y][player.x] === DOOR) propOpenDoors.delete(player.y * MAP_W + player.x);
    for (const o of OCT) castLight(player.x, player.y, 1, 1.0, 0.0, o[0], o[1], o[2], o[3]);
  }

  // ---- HUD / log -----------------------------------------------------------
  // A short scrollback (not just the latest line) — the box shows ~4 lines and
  // auto-scrolls to the newest as messages come in.
  const LOG_MAX_LINES = 60;
  function log(msg, tone) {
    const el = document.getElementById("log");
    if (!el) return;
    const line = document.createElement("div");
    line.className = "logline" + (tone ? " " + tone : "");
    line.textContent = msg;
    el.appendChild(line);
    while (el.children.length > LOG_MAX_LINES) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }
  function updateHP() {
    const el = document.getElementById("hp");
    if (!el) return;
    el.textContent = "♥ " + Math.max(0, player.hp) + "/" + player.maxHp;
    const r = player.hp / player.maxHp;
    el.className = "hp" + (r <= 0.3 ? " low" : r <= 0.6 ? " mid" : "");
  }
  // 5-segment turn-timer bar at the top: fills left→right per turnMeter (0–5),
  // colored green when the last action was hasted (cost<1), red when slowed
  // (cost>1), amber at normal pace.
  function updateTurnBar() {
    const bar = document.getElementById("turnBar");
    if (!bar) return;
    bar.classList.toggle("hasted", lastActionCost < 1);
    bar.classList.toggle("slowed", lastActionCost > 1);
    const segs = bar.querySelectorAll(".tseg");
    segs.forEach((seg, i) => {
      const frac = Math.max(0, Math.min(1, turnMeter - i));
      seg.classList.toggle("spent", frac <= 0);
      const fill = seg.querySelector(".tfill");
      if (fill) fill.style.width = (frac * 100) + "%";
    });
  }
  function updateHUD() {
    updateHP();
    updateTurnBar();
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
    if (inShop) { el.textContent = b.name + "  —  Merchant"; return; }
    el.textContent = b.name + "  " + floorInBiome(depth) + "/5" + (isBossDepth(depth) ? "  ⚔" : "");
  }

  // ---- Combat --------------------------------------------------------------
  // Remove a slain monster and award XP (with over-level scaling and boss handling).
  function killMonster(target, verb) {
    if (target.hp > 0 || !monsters.includes(target)) return;
    monsters = monsters.filter((m) => m !== target);
    propDoorOpenAt(target.x, target.y);   // died on a door/bush? it's propped open now
    log("The " + monName(target) + " " + (verb || "dies") + ".", "hit");
    // Regular monsters award XP by their tier: ceil(minFloor / 2) — floor 1–2 = 1,
    // floor 3–4 = 2, floor 5 = 3. Bosses give a larger scaled reward.
    let xp;
    if (target.boss) xp = 15 + Math.round(target.maxHp * 0.4);
    else { const mf = (VERMIN[target.type] && VERMIN[target.type].minFloor) || 1; xp = Math.max(1, Math.ceil(mf / 2)); }
    gainXP(xp);
    tickBoonKillCounters();
    _boss.onKill(target);
    if (target.boss && !monsters.some((m) => m.boss)) onBossDefeated(target.x, target.y);
  }

  const MAELON_KEYS = ["compost", "second_chance", "leper", "merciful", "dread"];
  const maelonBoonCount = () => (player.boons ? MAELON_KEYS.filter((k) => player.boons.has(k)).length : 0);
  // Kill-counter-driven boons: Maelon's Compost Pile (every 5), Kethara's Gift of
  // the Faithful (every 10), Ourn's Future Sight (every 10) / Dilating Pupils
  // (every 5) / The Pride Before The Fall (every 15, no floor — can go negative).
  function tickBoonKillCounters() {
    if (!player.boons || !player.boons.size) return;
    player.killCount = (player.killCount || 0) + 1;
    const kc = player.killCount;
    if (player.boons.has("compost") && kc % 5 === 0) {
      const s = STAT_KEYS.slice(0, 4)[randInt(0, 3)];   // STR/INT/VIT/DEX only
      player.stats[s]++;
      if (s === "VIT") player.maxHp = computeMaxHp();
      if (s === "INT") { player.maxMp = computeMaxMp(); player.mp = Math.min(player.mp + 1, player.maxMp); }
      floatText(player.x, player.y, "+1 " + s, "#e0685a");
      log("Maelon's Compost Pile bears fruit. (+1 " + s + ")", "hit");
    }
    if (player.boons.has("gift") && kc % 10 === 0) {
      player.stats.RES++;
      floatText(player.x, player.y, "+1 RES", "#b491d6");
      log("Kethara's Gift of the Faithful strengthens your resolve. (+1 RES)", "hit");
    }
    if (player.boons.has("foresight") && kc % 10 === 0) {
      player.boonAcc = (player.boonAcc || 0) + 1; player.boonEva = (player.boonEva || 0) + 1;
      floatText(player.x, player.y, "+1 ACC/EVA", "#9ad0ff");
      log("Ourn's Future Sight sharpens your senses. (+1 Accuracy, +1 Evasion)", "hit");
    }
    if (player.boons.has("dilating") && kc % 5 === 0) {
      player.boonHaste = (player.boonHaste || 0) + 1;
      floatText(player.x, player.y, "+1% haste", "#9ad0ff");
      log("Your pupils dilate a fraction further. (+1% Haste)", "hit");
    }
    if (player.boons.has("pride") && kc % 15 === 0) {
      for (const s of STAT_KEYS) player.stats[s]--;
      player.maxHp = computeMaxHp();
      player.maxMp = computeMaxMp(); player.mp = Math.min(player.mp, player.maxMp);
      floatText(player.x, player.y, "-1 all", "#e0685a");
      log("The Pride Before The Fall claims its due. (-1 to all stats)", "hurt");
    }
    updateHUD();
  }
  // Fire an item's enchants at a target. `power` is the source's primary number
  // (weapon atk on your strike, armor def when you retaliate). Returns nothing;
  // handles the target's death from burst damage.
  // Refresh a single-instance damage-over-time (burn — only ever one at a time).
  function addDot(m, dot) {
    if (!m.dots) m.dots = [];
    const ex = m.dots.find((d) => d.tag === dot.tag);
    if (ex) Object.assign(ex, dot); else m.dots.push(dot);
  }
  // Poison doesn't refresh or layer independent doses — every proc adds its
  // magnitude onto whatever's already ticking. Each turn the stack deals its
  // current total, then decays by 1 (see monsterAct), so a big early stack
  // keeps hurting as it winds down while the player backs off.
  function addPoison(m, amount) {
    if (amount <= 0) return;
    if (!m.dots) m.dots = [];
    const ex = m.dots.find((d) => d.tag === "poison");
    if (ex) ex.dmg += amount;
    else m.dots.push({ tag: "poison", dmg: amount, icon: "☠", color: "#9ad06a" });
  }

  // Fire an item's enchants at a target. `power` is the source's primary number
  // (weapon atk on your strike, armor def when you retaliate). `item` is the
  // instance bearing the enchant, used to look up its tier for tierValues.
  // Each enchant is driven by its `effect` block in the data (type + params),
  // so new enchants can be authored in the editor without touching this code.
  function procEnchants(enchants, target, power, incoming, item) {
    if (!enchants || !enchants.length || target.hp <= 0) return;
    for (const e of enchants) {
      if (target.hp <= 0) break;
      const def = LOOT.enchants[e] || {};
      const proc = (def.proc != null ? def.proc : 1) + eff("LCK") / 100;   // LCK: flat +% to all proc effects
      if (Math.random() >= proc) continue;
      const fx = def.effect || {};
      const icon = def.icon || "✦", color = def.color || "#cfe6ff";
      switch (fx.type) {
        case "burn": {                                  // instant burst + a short DOT that stacks only once
          const burst = Math.max(1, Math.ceil(power * (fx.burstMult != null ? fx.burstMult : 0.5)));
          target.hp -= burst; flash(target); floatText(target.x, target.y, "🔥-" + burst, "#ff8f4a");
          addDot(target, { tag: "burn", dmg: Math.max(1, Math.ceil(burst / 2)), rounds: fx.dotTurns || 3, icon: "🔥", color: "#ff8f4a" });
          break;
        }
        case "poison": {                                // adds a tiered dose to the running poison stack
          const mult = enchantTierValue(def, item, 0.2);
          const dose = Math.max(1, Math.round(power * mult));
          addPoison(target, dose);
          floatText(target.x, target.y, "☠+" + dose, "#9ad06a");
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
      const crit = Math.random() < critChance();       // 5%+ chance for 200%+ damage
      if (crit) dmg = Math.round(dmg * critMult());
      dmg = _boss.damageIn(target, dmg);   // a boss's playbook (e.g. the Golem's nodes) may shield it
      target.hp -= dmg;
      flash(target);
      floatText(target.x, target.y, (crit ? "CRIT " : "") + (surprise ? "!" : "") + "-" + dmg, crit ? "#ff6a6a" : (surprise ? "#ffd98a" : "#ffe08a"));
      const pre = surprise ? "Surprise! You strike the " : "You strike the ";
      if (player.weapon) gainIdentify(player.weapon, 1);   // learn a weapon by swinging it
      // Maelon's Merciful End: an execute threshold on a connecting hit.
      if (target.hp > 0 && player.boons && player.boons.has("merciful") && target.hp / target.maxHp < player.level / 100) {
        target.hp = 0; floatText(target.x, target.y, "EXECUTED", "#e0685a");
      }
      // Maelon's Leper Colony: chance to poison on a connecting hit.
      if (target.hp > 0 && player.boons && player.boons.has("leper")) {
        const poisonChance = Math.min(0.75, (player.level / 100) * maelonBoonCount());
        if (Math.random() < poisonChance) {
          addPoison(target, 2);
          floatText(target.x, target.y, "☠", "#9ad06a");
        }
      }
      if (target.hp <= 0) {
        killMonster(target, "dies");
      } else {
        log(pre + monName(target) + ". (-" + dmg + ")", "hit");
        // weapon enchants proc on a connecting hit (power = weapon damage)
        if (player.weapon) procEnchants(player.weapon.enchants, target, itemPower(player.weapon), null, player.weapon);
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
      // RES applies first, as a % reduction of the raw hit; armor (and other
      // flat mitigation) then reduces whatever's left.
      const resMult = Math.max(0, 1 - eff("RES") / 100);
      dmg = Math.max(1, Math.round(dmg * resMult) - armorBlock());
      player.hp -= dmg;
      flash(player);
      floatText(player.x, player.y, "-" + dmg, "#ff8f84");
      updateHUD();
      const verb = bonus > 0 ? " charges you!" : attacker.ranged ? " strikes from afar." : " hits you.";
      log("The " + monName(attacker) + verb + " (-" + dmg + ")", "hurt");
      if (player.hp <= 0) {
        // Maelon's Second Chance: intercept one fatal blow per run, then it's spent.
        if (player.boons && player.boons.has("second_chance") && !player.secondChanceUsed) {
          player.secondChanceUsed = true;
          player.boons.delete("second_chance");
          player.hp = player.maxHp;
          flashScreen("#e0685a", 500);
          floatText(player.x, player.y, "SAVED!", "#e0685a");
          log("Maelon grants a Second Chance — you're pulled back from death's door! (Full heal, boon spent)", "hit");
          updateHUD();
        } else { die(); return; }
      }
      // Maelon's Endless Dread: a wounding blow risks the attacker fleeing in terror.
      if (attacker.hp > 0 && player.boons && player.boons.has("dread")) {
        const fearChance = ((eff("VIT") + eff("RES") + eff("LCK")) / 3) / 100;
        if (Math.random() < fearChance) {
          attacker.fleeing = (attacker.fleeing || 0) + 10;
          floatText(attacker.x, attacker.y, "flees!", "#e0a848");
          log("The " + monName(attacker) + " recoils in dread and flees!", "hit");
        }
      }
      // taking a hit is how you learn your worn defensive gear, and how its
      // enchants (armor, rings, trinket, necklace) lash back at the attacker
      for (const it of wornItems()) {
        if (GEAR[it.key].cat === "weapon") continue;
        gainIdentify(it, 1);
        if (attacker.hp > 0 && it.enchants && it.enchants.length) procEnchants(it.enchants, attacker, itemPower(it), dmg, it);
      }
    }
  }

  // The nearest wall tile on the boss room's boundary to (dx, dy) — every side of
  // a room here is at least 4 tiles long, so this is always a real straight wall,
  // not a single corner nub.
  function nearestRoomWallSpot(room, dx, dy) {
    if (!room) return null;
    let best = null, bestD = Infinity;
    for (const [x, y] of roomRing(room)) {
      if (!inBounds(x, y) || map[y][x] !== WALL) continue;
      const d = cheb(x, y, dx, dy);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    return best;
  }
  function onBossDefeated(x, y) {
    bossActive = false;
    if (biome.final) { win(); return; }
    // The exit opens on the wall of the boss room nearest to where it fell —
    // not on the death tile itself, which could be anywhere in the room.
    const doorSpot = nearestRoomWallSpot(bossRoom, x, y) || { x, y };
    map[doorSpot.y][doorSpot.x] = STAIRS;
    explored[doorSpot.y][doorSpot.x] = true;
    computeFOV();
    // Boss reward: 3 Potions of Insight (not raw points — you still have to drink
    // them), a guaranteed-blue+ trinket, and a boon choice.
    const granted = grantInsightPotions(3);
    const trink = rollTrinket(depth);
    if (trink) {
      const spot = nearestFreeFloor(x, y) || { x, y };
      items.push(Object.assign({ x: spot.x, y: spot.y }, trink));
      floatText(spot.x, spot.y, "✦", "#9ad0ff");
    }
    // Boss boon choice: 3 distinct "Boon of [Family]" runes drop on the floor —
    // step onto one to claim it, and the other two fade away.
    const boonsDropped = dropBossBoonChoices(x, y);
    // Equipment set: a weapon, an armor, and a ring/necklace, rolled with access
    // to tiers well beyond the current floor.
    dropBossEquipmentSet(x, y);
    log("The " + bossName + " falls — the way opens. (+" + granted + " Potions of Insight" + (trink ? ", a trinket glints nearby" : "") + (boonsDropped ? ", and blessings + spoils scattered about" : "") + ")", "hit");
  }
  // Scatter `count` items on distinct free floor tiles within `radius` of (cx,cy).
  function distinctNearbySpots(cx, cy, radius, count) {
    const spots = []; const seen = new Set();
    for (let t = 0; t < 400 && spots.length < count; t++) {
      const x = cx + randInt(-radius, radius), y = cy + randInt(-radius, radius);
      if (!inBounds(x, y) || !passable(x, y) || shuns(x, y)) continue;
      const k = y * MAP_W + x;
      if (seen.has(k) || itemAt(x, y) || monsterAt(x, y) || (x === player.x && y === player.y)) continue;
      seen.add(k); spots.push({ x, y });
    }
    while (spots.length < count) spots.push({ x: cx, y: cy });   // fallback: stack if truly cramped
    return spots;
  }
  // Like distinctNearbySpots, but confined to one room's interior and spread
  // at least `minSep` tiles apart — for drops where the player needs to see
  // and reach EVERY spot on its own before committing to any one (a mutually-
  // exclusive boon choice), rather than being funneled past one to reach the
  // next in a corridor. Falls back to the radius scatter if the room can't
  // fit `count` well-separated spots.
  function distinctRoomSpots(room, count, cx, cy, minSep) {
    if (room) {
      const cand = [];
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          if (!passable(x, y) || shuns(x, y)) continue;
          if (itemAt(x, y) || monsterAt(x, y) || (x === player.x && y === player.y)) continue;
          cand.push([x, y]);
        }
      }
      for (let i = cand.length - 1; i > 0; i--) { const j = randInt(0, i); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
      const spots = [];
      for (const [x, y] of cand) {
        if (spots.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < minSep)) continue;
        spots.push({ x, y });
        if (spots.length >= count) return spots;
      }
    }
    return distinctNearbySpots(cx, cy, 2, count);   // room too small/absent — fall back
  }
  // Roll a gear item of a specific category (not the usual random-category pick).
  function rollGearOfCat(cat, floor) {
    const tier = _loot.pickTier(floor);
    const key = _loot.pickTypeInTierCat(cat, tier) || _loot.pickAnyInCat(cat, tier) || GEAR_KEYS.find((k) => GEAR[k].cat === cat);
    return key ? rollItem(key, floor) : null;
  }
  let boonGroupSeq = 0;
  // Drop 3 boon-choice runes near (x,y); claiming one despawns the other two
  // (handled in pickUp). Returns how many were dropped (0 if every boon is owned).
  function dropBossBoonChoices(x, y) {
    const all = DATA.boons || {};
    const avail = Object.keys(all).filter((k) => !(player.boons && player.boons.has(k)));
    if (!avail.length) return 0;
    for (let i = avail.length - 1; i > 0; i--) { const j = randInt(0, i); const t = avail[i]; avail[i] = avail[j]; avail[j] = t; }
    const pick = avail.slice(0, 3);
    const groupId = ++boonGroupSeq;
    const spots = distinctRoomSpots(bossRoom, pick.length, x, y, 3);
    pick.forEach((k, i) => { const s = spots[i]; items.push({ x: s.x, y: s.y, boonKey: k, boonGroup: groupId }); });
    return pick.length;
  }
  // Drop a weapon + armor + ring/necklace, rolled with tiers boosted well past
  // the current floor — a boss's equipment reward should outclass normal drops.
  function dropBossEquipmentSet(x, y) {
    const bonusFloor = depth + 10;
    const accCat = Math.random() < 0.5 ? "ring" : "necklace";
    const drops = [rollGearOfCat("weapon", bonusFloor), rollGearOfCat("armor", bonusFloor), rollGearOfCat(accCat, bonusFloor)].filter(Boolean);
    if (!drops.length) return;
    const spots = distinctNearbySpots(x, y, 2, drops.length);
    drops.forEach((it, i) => { const s = spots[i]; items.push(Object.assign({ x: s.x, y: s.y }, it)); floatText(s.x, s.y, "✦", "#f0c14b"); });
  }
  // Add n Insight potions to the pack (stacks), spilling to the floor if full.
  function grantInsightPotions(n) {
    let added = 0;
    for (let i = 0; i < n; i++) {
      if (invAdd({ key: "skill_point" })) { added++; continue; }
      const spot = dropSpot();
      if (spot) { items.push({ x: spot.x, y: spot.y, key: "skill_point" }); added++; }
    }
    return added;
  }

  // ---- Character select: choose your hero at the start of each run -----------
  let classSelectCb = null;   // the pending choice's callback, exposed for the pickClass dev hook
  function offerClassSelect(cb) {
    const roster = Object.keys(DATA.classes || {}).filter((k) => DATA.classes[k].unlock === "start");
    const wrap = document.getElementById("classChoices");
    if (!wrap || !roster.length) { cb((roster && roster[0]) || player.cls || "warrior"); return; }
    const choose = (k) => {
      const el = document.getElementById("classSelect"); if (el) el.hidden = true;
      classPending = false; classSelectCb = null;
      cb(k);
    };
    classSelectCb = choose;
    wrap.innerHTML = "";
    for (const k of roster) {
      const c = DATA.classes[k] || {};
      const btn = document.createElement("button");
      btn.className = "class-choice"; btn.type = "button";
      btn.innerHTML = `<span class="b-icon">${c.icon || "⚔"}</span>` +
        `<span class="b-text"><span class="b-name">${c.name || k}</span>` +
        `<span class="b-desc">${c.blurb || ""}</span></span>`;
      btn.addEventListener("click", () => choose(k));
      wrap.appendChild(btn);
    }
    walkPath = [];                  // don't let a queued walk fire under the modal
    classPending = true;
    document.getElementById("classSelect").hidden = false;
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
    // Guild's Artificer's Tools: 3-5 Scrolls of Upgrade, straight into the pack.
    if (key === "artificer") {
      const n = randInt(3, 5);
      for (let i = 0; i < n; i++) {
        if (!invAdd({ key: "scroll_upgrade" })) { const spot = dropSpot(); if (spot) items.push(Object.assign({ x: spot.x, y: spot.y }, { key: "scroll_upgrade" })); }
      }
      log("The Guild's artificers press " + n + " Scrolls of Upgrade into your hands.", "hit");
    }
    // Ourn's The Pride Before The Fall: +10 to every base stat, right away.
    if (key === "pride") {
      const beforeHp = player.maxHp, beforeMp = player.maxMp;
      for (const s of STAT_KEYS) player.stats[s] += 10;
      player.maxHp = computeMaxHp();
      player.hp += Math.max(0, player.maxHp - beforeHp);
      player.maxMp = computeMaxMp();
      player.mp += Math.max(0, player.maxMp - beforeMp);
      floatText(player.x, player.y, "+10 ALL", "#9ad0ff");
      log("The Pride Before The Fall floods you with power. (+10 to all stats)", "hit");
    }
    grantBoonSkills(key);   // wires up any active ability this boon unlocks (wall/pull/eye/anger/speed of light)
    updateHUD(); updateHotbar();
    if (charOpen) renderChar();
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
      // No free skill point here — skill points now come only from Potions of
      // Insight (1 guaranteed per floor, 3 more on a boss kill).
      const lu = cls.levelUp || {};            // flat per-level set (hp/mp/accuracy/evasion)
      player.lvlHp += lu.hp || 0;
      player.lvlAcc += lu.accuracy || 0;
      player.lvlEva += lu.evasion || 0;
      player.lvlCrit += lu.crit || 0;
      player.lvlCritDmg += lu.critDmg || 0;
      player.lvlMp += lu.mp || 0;
      const nmMp = computeMaxMp();
      player.mp = Math.min(nmMp, player.mp + (nmMp - player.maxMp));   // gain by the max-MP increase
      player.maxMp = nmMp;
      const nm = computeMaxHp();
      player.hp = Math.min(nm, player.hp + (nm - player.maxHp));   // heal by the max-HP gain
      player.maxHp = nm;
      const extra = [];
      if (lu.hp) extra.push("+" + lu.hp + " HP"); if (lu.mp) extra.push("+" + lu.mp + " MP");
      if (lu.accuracy) extra.push("+" + lu.accuracy + " acc"); if (lu.evasion) extra.push("+" + lu.evasion + " eva");
      if (lu.crit) extra.push("+" + lu.crit + "% crit"); if (lu.critDmg) extra.push("+" + lu.critDmg + "% crit dmg");
      log("Level " + player.level + "!  +2 " + cls.main + ", +1 " + cls.secondary + (extra.length ? " · " + extra.join(", ") : ""), "hit");
      const gains = ["+2 " + cls.main, "+1 " + cls.secondary].concat(extra);
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
  // `mover` is optional and means "on whose behalf" — omit it for the player and for
  // anything walking on foot; pass the monster so a flier may cross deep water.
  function canStep(x, y, dx, dy, mover) {
    const nx = x + dx, ny = y + dy;
    if (!passableFor(mover, nx, ny)) return false;
    // no diagonal squeeze past a corner flanked by walls OR thorns — so a wall of
    // brambles can't be slipped around diagonally without stepping through it. Water
    // flanks the same way for whoever can't enter it: a walker can't cut the corner
    // between two ponds, a flier doesn't notice them.
    if (dx !== 0 && dy !== 0) {
      const blockA = !passableFor(mover, x + dx, y) || shuns(x + dx, y);
      const blockB = !passableFor(mover, x, y + dy) || shuns(x, y + dy);
      if (blockA && blockB) return false;
    }
    return true;
  }

  // Returns true if a turn was spent.
  function playerAct(dx, dy) {
    if (dead || (dx === 0 && dy === 0)) return false;
    if (player.stun > 0) { player.stun--; floatText(player.x, player.y, "stunned", "#e0a848"); log("You're too dazed to act!", "hurt"); worldTurn(); return true; }
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
      worldTurn(walkCost());     // Metrognome (walk) → you cover ground faster than your foes. Terrain never costs extra time: it shapes the route instead of taxing it, and a costlier step used to hand every monster in earshot a free second action.
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
    if (it.boonKey) {
      const siblings = items.filter((x) => x.boonGroup === it.boonGroup && x !== it);
      for (const s of siblings) spawnBurst(s.x, s.y, "#8a7a5a");
      items = items.filter((x) => x.boonGroup !== it.boonGroup);
      pickBoon(it.boonKey);
      if (siblings.length) log("The other blessings fade away.");
      return;
    }
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
    if (inShop) {   // leaving the merchant floor — now actually advance to the next depth
      inShop = false;
      shopKeeper = null; fountain = null; shopStock = [];
      depth++;
      setDepthLabel();
      generateLevel();
      log("You descend to depth " + depth + ".");
      return;
    }
    if (isBossDepth(depth)) {   // stairs out of a just-cleared boss room lead to the merchant first
      inShop = true;
      generateShopLevel();
      log("You find a merchant's den.");
      return;
    }
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

  // Starts (or restarts) a run as whatever class is currently set on player.cls —
  // used directly by dev/test hooks. Real player-facing "new run" triggers go
  // through beginNewRun() below, which asks for a character first.
  function restart() {
    dead = false;
    depth = 1;
    turnMeter = 5; lastActionCost = 1;
    inShop = false; shopKeeper = null; fountain = null; shopStock = [];
    toggleShop(false); toggleFountain(false);
    resetPlayer();
    setDepthLabel();
    updateHUD();
    const over = document.getElementById("gameover");
    if (over) over.hidden = true;
    const winEl = document.getElementById("win");
    if (winEl) winEl.hidden = true;
    const boonEl = document.getElementById("boons");
    if (boonEl) boonEl.hidden = true;
    const clsEl = document.getElementById("classSelect");
    if (clsEl) clsEl.hidden = true;
    boonPending = false;
    classPending = false;
    classSelectCb = null;
    generateLevel();
    log("A new adventurer enters the dungeon.");
    offerBoons();      // a god extends a blessing at the very start of the run too
  }
  // Player-facing "start a new run" entry point: choose a hero, then restart() as them.
  function beginNewRun() {
    offerClassSelect((clsKey) => { player.cls = clsKey; restart(); });
  }

  // ---- Monster turns -------------------------------------------------------
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const SENSE = 8;          // how far a monster notices the player (needs line of sight)
  const CHARGE_MAX = 7;
  let turns = 0;
  let boonPending = false;    // a boss-reward boon choice is open — block play until picked
  let classPending = false;   // the start-of-run character-select modal is open — block play until picked

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
  // Drains the Potion of Healing overflow queue: up to VIT more HP per turn,
  // on top of (not instead of) passive regen above.
  function healQueueTick() {
    if (!player.healPending || player.hp >= player.maxHp) { if (player.hp >= player.maxHp) player.healPending = 0; return; }
    const amt = Math.min(player.healPending, Math.max(1, eff("VIT")), player.maxHp - player.hp);
    if (amt <= 0) return;
    player.hp += amt; player.healPending -= amt;
    floatText(player.x, player.y, "+" + amt, "#8ed69a");
    updateHUD();
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

  // True shortest-path first-step toward (tx,ty) — a small BFS over the same
  // canStep connectivity (corner-cut safe, thorns excluded), recomputed fresh
  // each call. Replaces a 1-step-lookahead "closest neighbor" heuristic that
  // could stall or oscillate against an inner diagonal corner (the neighbor
  // that would cut distance is corner-blocked, and every other neighbor ties),
  // which read as monsters getting "stuck" chasing around a bend.
  function monsterPathStep(sx, sy, tx, ty, mover) {
    if (sx === tx && sy === ty) return null;
    const key = (x, y) => y * MAP_W + x;
    const prev = new Map();
    prev.set(key(sx, sy), null);
    const queue = [[sx, sy]];
    let head = 0;
    const MAX_NODES = 2600;   // ~ one full 51×51 floor — plenty, and a hard safety cap
    while (head < queue.length && queue.length < MAX_NODES) {
      const [cx, cy] = queue[head++];
      if (cx === tx && cy === ty) break;
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx, ny = cy + dy;
        if (!inBounds(nx, ny) || !canStep(cx, cy, dx, dy, mover) || shuns(nx, ny)) continue;
        // occupied tiles block passage, unless a tile IS the goal (so the search
        // can still route a monster up next to the player or another monster)
        if ((nx !== tx || ny !== ty) && (monsterAt(nx, ny) || (nx === player.x && ny === player.y))) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, [cx, cy]);
        queue.push([nx, ny]);
      }
    }
    if (!prev.has(key(tx, ty))) return null;
    let cur = [tx, ty], path = [];
    while (cur) { path.push(cur); cur = prev.get(key(cur[0], cur[1])); }
    path.reverse();
    return path.length > 1 ? path[1] : null;   // path[0] is the monster's own tile
  }
  // EVERY ordinary monster step goes through here. A world turn hands the acting
  // monster a leg buffer (see worldTurn) and this records the tile it actually
  // landed on, so the renderer walks the real path. Diffing a monster's position
  // before and after its whole action instead — which is what this replaced —
  // loses every tile in between, and the tween then draws one straight line from
  // start to finish: a monster that legally stepped around a bush was drawn
  // sliding clean through the bush, and one that stepped past you was drawn
  // sliding through you. That is the "teleport" players were seeing.
  //
  // A charge is the deliberate exception: it really does cross several tiles in
  // one straight dash, so it moves without recording legs and keeps the longer
  // `moveMs` slide it sets for itself.
  let legLog = null;   // { m, legs } while a monster is taking its action
  function moveMonster(m, nx, ny) {
    m.x = nx; m.y = ny;
    if (legLog && legLog.m === m) legLog.legs.push([nx, ny]);
  }
  function stepMonsterTo(m, tx, ty) {
    // monsterPathStep lets the GOAL tile itself be occupied (so a path can still
    // route up to it) — but if that goal happens to be the very next step (the
    // monster is already adjacent to it), committing the move would stack two
    // monsters on one tile. Every monster must have its own tile, so re-check
    // occupancy here before actually moving; fall through to the greedy
    // heuristic below (which already excludes occupied tiles) if it's blocked.
    const step = monsterPathStep(m.x, m.y, tx, ty, m);
    if (step && !monsterAt(step[0], step[1]) && !(step[0] === player.x && step[1] === player.y)) { moveMonster(m, step[0], step[1]); return; }
    // No path found (e.g. fully boxed in this turn) — fall back to the old
    // greedy "closest open neighbor" so the monster doesn't just freeze.
    // Seeded with the CURRENT distance, so the fallback can only ever take a step
    // that gets strictly closer. Seeding it with Infinity meant any legal
    // neighbour beat "stay put": a monster already standing on its target was
    // shoved straight back off it (every neighbour ties at distance 1), which is
    // how a search could turn into a two-tile-per-action shuffle.
    let best = null, bestD = cheb(m.x, m.y, tx, ty);
    for (const [dx, dy] of DIRS8) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!canStep(m.x, m.y, dx, dy, m) || shuns(nx, ny)) continue;   // monsters won't brave hazards they shun
      if (nx === player.x && ny === player.y) continue;
      if (monsterAt(nx, ny)) continue;
      const d = cheb(nx, ny, tx, ty);
      if (d < bestD) { bestD = d; best = [nx, ny]; }
    }
    if (best) moveMonster(m, best[0], best[1]);
  }
  // Wandering used to be a greedy step toward a random tile with no memory of where
  // it came from. When the target sits behind something the monster won't cross —
  // a thorn it shuns, a closed door — the greedy rule has no way out: from A the
  // best step is B, from B the best step is A, and it paces between them forever.
  // Two additions break that: never step straight back onto the tile just left
  // unless there is nowhere else to go, and give up on a target that isn't getting
  // closer instead of only when no step improves at all.
  // Wandering was a greedy step toward a random tile: move to whichever neighbour
  // has the lowest Chebyshev distance. Greedy stepping has no escape from a local
  // minimum, so a monster whose target sits behind something it will not cross —
  // a thorn it shuns, a closed door — paces between two tiles indefinitely.
  // Measured on that rule, 15 of 18 roaming monsters covered three tiles or fewer
  // over 300 turns; the median never left its starting tile.
  //
  // Wandering now uses the same BFS the hunting AI already uses, which cannot be
  // trapped that way, and re-rolls its destination once it stops making progress.
  const PATROL_PATIENCE = 12;
  function patrolStep(m) {
    if (!m.patrol || (m.x === m.patrol.x && m.y === m.patrol.y)) {
      m.patrol = randomFloor(); m.patrolBest = null; m.patrolStale = 0;
    }
    if (!m.patrol) return;
    stepMonsterTo(m, m.patrol.x, m.patrol.y);
    const d = cheb(m.x, m.y, m.patrol.x, m.patrol.y);
    if (m.patrolBest == null || d < m.patrolBest) { m.patrolBest = d; m.patrolStale = 0; return; }
    // Not closer than our best so far: blocked, circling, or it cannot be reached.
    if (++m.patrolStale >= PATROL_PATIENCE) { m.patrol = randomFloor(); m.patrolBest = null; m.patrolStale = 0; }
  }
  // Shattered Pixel Dungeon-style hunt: losing sight doesn't mean forgetting —
  // a monster with a lastSeen trail heads straight there. Arriving to an empty
  // tile isn't proof you vanished into thin air (through a bush, round a
  // corner), so it spends a few turns poking around nearby before finally
  // giving up and going back to idle patrol (Hunting → searching Wandering →
  // idle Wandering, the same chain SPD's mobs use).
  const SEARCH_TURNS = 4;
  function nearbySearchSpot(cx, cy) {
    for (let t = 0; t < 10; t++) {
      const nx = cx + randInt(-2, 2), ny = cy + randInt(-2, 2);
      if (inBounds(nx, ny) && map[ny][nx] === FLOOR) return { x: nx, y: ny };
    }
    return null;
  }
  // ONE step per call, always. The two phases used to run back to back: the same
  // action walked the monster onto the last-seen tile and then straight off it
  // toward a search spot, so a search was two tiles of movement per action (four
  // for anything that acted twice), and it ping-ponged — having stepped away it
  // was no longer on lastSeen, so the next action walked it back and off again.
  // An `m.searching` latch splits the phases so arriving IS that action's move.
  function chaseLastSeen(m) {
    // Phase 1 — travel to the tile we last saw the player on.
    if (!m.searching) {
      stepMonsterTo(m, m.lastSeen.x, m.lastSeen.y);
      if (m.x === m.lastSeen.x && m.y === m.lastSeen.y) {   // arrived; start poking around next action
        m.searching = true; m.searchTurns = SEARCH_TURNS; m.searchSpot = null;
      }
      return;
    }
    // Phase 2 — an empty tile isn't proof you vanished; check a few spots nearby.
    if (m.searchTurns > 0) {
      m.searchTurns--;
      if (!m.searchSpot || (m.x === m.searchSpot.x && m.y === m.searchSpot.y)) {
        m.searchSpot = nearbySearchSpot(m.lastSeen.x, m.lastSeen.y);
      }
      if (m.searchSpot) stepMonsterTo(m, m.searchSpot.x, m.searchSpot.y);
      return;
    }
    m.lastSeen = null; m.aware = false; m.searching = false; m.searchTurns = null; m.searchSpot = null;
  }
  function doCharge(m) {
    const dir = straightDir(m);
    const sx = m.x, sy = m.y;
    let moved = 0;
    while (cheb(m.x, m.y, player.x, player.y) > 1) {
      const nx = m.x + dir[0], ny = m.y + dir[1];
      if (nx === player.x && ny === player.y) break;
      if (!canStep(m.x, m.y, dir[0], dir[1], m) || shuns(nx, ny) || monsterAt(nx, ny)) break;
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
      if (!canStep(m.x, m.y, dx, dy, m) || shuns(nx, ny) || monsterAt(nx, ny)) continue;
      if (nx === player.x && ny === player.y) continue;
      const ddx = player.x - nx, ddy = player.y - ny;
      const dist = Math.max(Math.abs(ddx), Math.abs(ddy));
      const aligned = (ddx === 0 || ddy === 0 || Math.abs(ddx) === Math.abs(ddy));
      let score = -dist;                                    // closing in is good
      if (aligned && dist >= 2 && dist <= CHARGE_MAX && lineOfSight(nx, ny, player.x, player.y)) score += 100;  // a charge lane = great
      if (score > bestScore) { bestScore = score; best = [nx, ny]; }
    }
    if (best) moveMonster(m, best[0], best[1]);
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
      if (!inBounds(gx, gy) || tileProp(gx, gy, "solid") || shuns(gx, gy)) continue;
      if (cheb(gx, gy, cx, cy) > radius) continue;
      if (monsterAt(gx, gy) || (gx === player.x && gy === player.y)) continue;
      const mm = makeMonster(type, gx, gy); mm.aware = true;
      monsters.push(mm); placed++;
    }
    return placed;
  }
  // Teleported, not walked: drop any walk path, including legs banked earlier in
  // this same turn — a blink must never be drawn as a stroll across the floor.
  function snapEntity(m) {
    m.rx = m.x; m.ry = m.y; m.tx = m.x; m.ty = m.y; m.ax = m.x; m.ay = m.y; m.at = 0; m.wp = null;
    if (legLog && legLog.m === m) legLog.legs.length = 0;
  }

  function monsterAct(m) {
    if (m.hp <= 0) return;
    if (m.dots && m.dots.length) {              // burn/poison ticks at the start of its action
      for (const dot of m.dots.slice()) {
        m.hp -= dot.dmg; flash(m); floatText(m.x, m.y, dot.icon + "-" + dot.dmg, dot.color);
        // Poison has no fixed duration — its own stack decays by 1 each tick,
        // fading out once spent. Burn (and anything else) still runs on rounds.
        if (dot.tag === "poison") { if (--dot.dmg <= 0) m.dots = m.dots.filter((x) => x !== dot); }
        else if (--dot.rounds <= 0) m.dots = m.dots.filter((x) => x !== dot);
        if (m.hp <= 0) { killMonster(m, dot.tag === "poison" ? "succumbs to poison" : "burns away"); return; }
      }
    }
    if (m.stun && m.stun > 0) { m.stun--; floatText(m.x, m.y, "zzz", "#cfe6ff"); return; }  // stunned: skip
    if (m.type === "healing_node") return;                       // passive — never acts, just shields the golem
    // A boss with a registered playbook (bosses.js) runs its own turn instead
    // of the default AI below — see docs/BOSSES.md.
    const pb = _boss.playbookFor(m.type);
    if (pb && pb.act) { pb.act(m); return; }
    defaultAct(m);
  }
  function defaultAct(m) {
    // Maelon's Endless Dread: a terrified monster runs directly away from the player.
    if (m.fleeing > 0) {
      m.fleeing--;
      const dx = Math.sign(m.x - player.x) || (Math.random() < 0.5 ? 1 : -1);
      const dy = Math.sign(m.y - player.y) || (Math.random() < 0.5 ? 1 : -1);
      const nx = m.x + dx, ny = m.y + dy;
      // canStep, not a bare passableFor: a panicking monster still can't squeeze
      // diagonally past a corner. And the player occupies a tile like anything
      // else — without this check a monster fleeing along your axis would flee
      // straight *through* you.
      if (canStep(m.x, m.y, dx, dy, m) && !shuns(nx, ny) && !monsterAt(nx, ny) && !(nx === player.x && ny === player.y)) moveMonster(m, nx, ny);
      return;
    }
    // Kethara's Anger of Kethara: a berserk monster turns on whatever's nearest, not just the player.
    if (m.berserk > 0) {
      m.berserk--;
      let nearest = null, nd = Infinity;
      for (const o of monsters) {
        if (o === m || o.hp <= 0 || o.type === "healing_node") continue;
        const dd = cheb(m.x, m.y, o.x, o.y);
        if (dd < nd) { nd = dd; nearest = o; }
      }
      const dPlayer = cheb(m.x, m.y, player.x, player.y);
      if (nearest && nd <= dPlayer) {
        if (nd === 1) { monsterVsMonster(m, nearest); return; }
        stepMonsterTo(m, nearest.x, nearest.y);
        return;
      }
      // no other target closer than the player → fall through to normal player-seeking behavior
    }
    if (canSee(m)) { m.aware = true; m.lastSeen = { x: player.x, y: player.y }; m.searching = false; m.searchTurns = null; m.searchSpot = null; }  // spotted: remember where, fresh search budget for next time it loses you
    const d = cheb(m.x, m.y, player.x, player.y);
    if (d === 1) { attack(m, player); return; }
    if (m.ranged && d <= (m.range || 4) && lineOfSight(m.x, m.y, player.x, player.y)) { spawnProjectile(m.x, m.y, player.x, player.y, m.color || "#e0d0a0"); attack(m, player); return; }
    if (m.charge && d >= 2 && d <= CHARGE_MAX && straightDir(m) && lineOfSight(m.x, m.y, player.x, player.y)) { doCharge(m); return; }
    // Kethara's Faith's Pull: an aware monster caught in the aura paths to its
    // center instead of the player, for as long as the pull lasts.
    if (pullZone && pullZone.turns > 0 && m.aware && cheb(m.x, m.y, pullZone.x, pullZone.y) <= 4) {
      stepMonsterTo(m, pullZone.x, pullZone.y);
      return;
    }
    if (canSee(m)) { if (m.charge) chargeApproach(m); else stepMonsterTo(m, player.x, player.y); return; }   // in sight → close in (chargers line up)
    if (m.lastSeen) { chaseLastSeen(m); return; }   // lost sight → head to where you were last seen, then search nearby
    patrolStep(m);                               // no lead → wander
  }
  // A lightweight monster-vs-monster strike (Anger of Kethara only) — no crits,
  // affixes, or identify progress; just a hit-chance roll and flat damage.
  function monsterVsMonster(attacker, target) {
    const acc = attacker.acc != null ? attacker.acc : MON_ACC;
    const eva = target.eva != null ? target.eva : MON_EVA;
    if (!rollHit(acc, eva)) { floatText(target.x, target.y, "miss", "#cfe6b0"); return; }
    let dmg = randInt(attacker.atkMin, attacker.atkMax);
    dmg = Math.round(dmg * 1.5);   // berserk hits harder
    target.hp -= dmg;
    flash(target);
    floatText(target.x, target.y, "-" + dmg, "#ff8f84");
    if (target.hp <= 0) killMonster(target, "is torn apart");
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
  const MAX_ACTS_PER_TURN = 2;   // no monster may take more than this in one world turn
  function worldTurn(cost) {
    cost = cost == null ? 1 : cost;
    turns++;
    // Top turn-timer bar: 5 turns of banked time, drained by this action's cost
    // (a hasted action costs less and drains it slower; a slowed one drains it
    // faster). Wraps back up when it empties — a rolling pace indicator.
    turnMeter -= cost;
    while (turnMeter <= 0) turnMeter += 5;
    lastActionCost = cost;
    for (const k in player.skills) if (player.skills[k].cd > 0) player.skills[k].cd--;
    if (player.stoneSkin && player.stoneSkin.turns > 0 && --player.stoneSkin.turns <= 0) {
      player.stoneSkin = null; log("Your stone skin crumbles away.");
    }
    if (player.hasteBuff > 0) player.hasteBuff = Math.max(0, player.hasteBuff - 1);   // Speed of Light: decays 1%/turn
    if (pullZone) { pullZone.turns--; if (pullZone.turns <= 0) pullZone = null; }      // Faith's Pull: expires after 5 turns
    if (activeWalls.length) {                                                          // Wall of Faith: reverts after its life
      const stillUp = [];
      for (const w of activeWalls) {
        w.turns--;
        if (w.turns <= 0 && inBounds(w.x, w.y) && map[w.y][w.x] === WALL) { map[w.y][w.x] = FLOOR; }
        else stillUp.push(w);
      }
      if (stillUp.length !== activeWalls.length) computeFOV();
      activeWalls = stillUp;
    }
    tickBombs(); if (dead) return;              // armed bomb traps count down and detonate
    _boss.tick(); if (dead) return;             // a boss's delayed effects (e.g. the Golem's node blasts)
    panX = 0; panY = 0; enemyFocusIdx = -1; pendingThrow = null;   // any action recenters the camera on you
    for (const m of monsters.slice()) {
      if (m.hp <= 0) continue;
      m.energy = (m.energy || 0) + (m.speed || 1) * cost;
      // Record each tile this turn actually steps onto, so the renderer can walk
      // the real path instead of interpolating straight through whatever the
      // monster stepped around (see animEntity). moveMonster does the recording
      // at the point of the move — reading m.x/m.y before and after each action
      // instead only ever yields the tile the action ENDED on, so any action that
      // moved more than once was drawn as a straight glide through the tiles in
      // between.
      const legs = [];
      legLog = { m, legs };
      // Hard cap on actions per world turn. A slow weapon costs the player more
      // than 1, which hands every monster 2 actions — that is the intended rule,
      // but a third would be unreadable however it is drawn, so banked energy
      // beyond two acts is simply dropped rather than spent.
      let acts = 0;
      while (m.energy >= 1 && acts < MAX_ACTS_PER_TURN && m.hp > 0 && !dead) {
        m.energy -= 1; acts++;
        monsterAct(m);
      }
      legLog = null;
      m.acts = acts;   // actions taken this world turn — a monster may move at most
                       // one tile per action, which tests/smoke.js asserts
      if (m.energy >= 1) m.energy = 0;    // dropped, per the cap above — banking a whole
                                          // action here just moved the burst to next turn
      // No legs this turn means nothing to walk (it charged, blinked, or stood
      // still), so clear the path rather than leaving last turn's behind — a
      // stale wp outranks moveMs in animEntity, which turned a bear's long
      // charge slide back into a single 120ms hop to a tile it already left.
      m.wp = null;
      if (legs.length) {
        m.wp = legs;                       // ALWAYS walk the real tiles, one at a time
        // Split one move's worth of time across the legs, so a two-step turn reads
        // as two distinct hops without the world running at half speed.
        m.legMs = MOVE_MS / legs.length;
      }
      if (dead) return;
    }
    regenTick();
    healQueueTick();
    searchForTraps();
    maybeReinforce();
    updateHotbar();
    // Doors/bushes count as open while something stands in them, so the monsters
    // that just moved have changed what you can see through. Recompute before the
    // frame is drawn, otherwise a monster stepping into a doorway stays hidden
    // until your NEXT action and then pops into view somewhere else entirely.
    computeFOV();
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
        if (!canStep(cx, cy, dx, dy) || tileProp(nx, ny, "noTravel")) continue;  // never auto-walk through no-travel hazards
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
    if (player.stun > 0 && !examineMode) { player.stun--; floatText(player.x, player.y, "stunned", "#e0a848"); log("You're too dazed to act!", "hurt"); worldTurn(); return; }
    if (examineMode) { describeTile(tx, ty); toggleExamine(false); updateHotbar(); return; }
    if (pendingThrow != null) { const idx = pendingThrow; executeThrow(idx, tx, ty); return; }
    if (pendingSkill && skillDef(pendingSkill) && skillDef(pendingSkill).kind === "rush") {
      const dir = [Math.sign(tx - player.x), Math.sign(ty - player.y)];
      if (dir[0] || dir[1]) executeRush(pendingSkill, dir); else { pendingSkill = null; updateHotbar(); }
      return;
    }
    if (pendingSkill && skillDef(pendingSkill)) {
      const pk = skillDef(pendingSkill).kind;
      if (pk === "wallcast" || pk === "pullcast") {
        if (!inBounds(tx, ty) || !visible[ty][tx]) { log("Out of sight."); return; }
        if (pk === "wallcast") executeWallOfFaith(pendingSkill, tx, ty); else executeFaithsPull(pendingSkill, tx, ty);
        return;
      }
      if (pk === "eyecast" || pk === "angercast") {
        const m = monsterAt(tx, ty);
        if (!m || !inBounds(tx, ty) || !visible[ty][tx]) { log("No target there."); return; }
        if (pk === "eyecast") executeEyeOfKethara(pendingSkill, tx, ty); else executeAngerOfKethara(pendingSkill, tx, ty);
        return;
      }
      if (pk === "smite") {
        const m = monsterAt(tx, ty);
        if (!m || !inBounds(tx, ty) || !visible[ty][tx]) { log("No target there."); return; }
        executeSmite(pendingSkill, tx, ty);
        return;
      }
      if (pk === "throwmon") {
        const m = monsterAt(tx, ty);
        if (!m || !inBounds(tx, ty) || !visible[ty][tx]) { log("No target there."); return; }
        executeThrowSkill(pendingSkill, tx, ty);
        return;
      }
    }
    if (walkPath.length) { walkPath = []; return; }           // tap while travelling = stop
    if (!inBounds(tx, ty)) return;
    const adjacent = cheb(player.x, player.y, tx, ty) === 1;
    // tap the shopkeeper or fountain (merchant floor only, wall-mounted like a
    // torch) — adjacent opens their UI directly; otherwise walk up to them first.
    if (shopKeeper && shopKeeper.x === tx && shopKeeper.y === ty) {
      if (adjacent) { toggleShop(true); return; }
      const spot = adjacentReachableFloor(tx, ty);
      if (spot) { const path = findPath(player.x, player.y, spot.x, spot.y); if (path.length) { walkPath = path; return; } }
      return;
    }
    if (fountain && fountain.x === tx && fountain.y === ty) {
      if (adjacent) { toggleFountain(true); return; }
      const spot = adjacentReachableFloor(tx, ty);
      if (spot) { const path = findPath(player.x, player.y, spot.x, spot.y); if (path.length) { walkPath = path; return; } }
      return;
    }
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
    if (dead || mapOpen || invOpen || charOpen || boonPending || classPending) return;
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
  // A boss's boon-choice drop: a pulsing glowing rune (a diamond), tinted to
  // the boon's own colour so all 3 choices read as distinct at a glance.
  function drawBoonRune(px, py, color, now) {
    const cx = px + tile / 2, cy = py + tile / 2;
    const pulse = 0.6 + 0.35 * Math.abs(Math.sin(now / 260));
    const g = ctx.createRadialGradient(cx, cy, tile * 0.05, cx, cy, tile * 0.55);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = pulse * 0.5; ctx.fillStyle = g;
    ctx.fillRect(px, py, tile, tile);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - tile * 0.26); ctx.lineTo(cx + tile * 0.22, cy); ctx.lineTo(cx, cy + tile * 0.26); ctx.lineTo(cx - tile * 0.22, cy);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = Math.max(1, tile * 0.04);
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
  // Placeholder draws for the C1 hazard tiles — nothing places them yet (that's
  // C2/C3), but a tile with no draw case would render as an invisible hole.
  // Deeper and darker than the puddle this used to be — water is a barrier now, and
  // it has to read as one at a glance, not as floor with a blue tint.
  function drawWater(px, py, b) {
    ctx.fillStyle = shade("#123a5e", b); ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = shade("#1d5480", b * 0.9); ctx.fillRect(px, py + tile * 0.18, tile, tile * 0.16);
    ctx.fillStyle = shade("#1d5480", b * 0.7); ctx.fillRect(px, py + tile * 0.62, tile, tile * 0.12);
  }
  function drawChasm(px, py, b) { ctx.fillStyle = shade("#0c0c10", b); ctx.fillRect(px, py, tile, tile); }
  function drawRubble(px, py, b) { ctx.fillStyle = shade("#6f6a5e", b); ctx.fillRect(px, py, tile, tile); }
  function drawGrass(px, py, b) { ctx.fillStyle = shade("#3a6b2e", b); ctx.fillRect(px, py, tile, tile); }
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
  // The shopkeeper: a robed figure standing in a recessed wall alcove, same
  // "built into the wall" convention as a torch bracket.
  function drawShopkeeper(px, py, b) {
    const cx = px + tile / 2, cy = py + tile * 0.62;
    ctx.fillStyle = "rgba(10,7,4,0.35)";
    ctx.fillRect(px + tile * 0.1, py, tile * 0.8, tile);
    // robe
    ctx.beginPath();
    ctx.moveTo(cx, py + tile * 0.30);
    ctx.lineTo(cx + tile * 0.24, py + tile * 0.92);
    ctx.lineTo(cx - tile * 0.24, py + tile * 0.92);
    ctx.closePath();
    ctx.fillStyle = shade("#8a5a3c", b);
    ctx.fill();
    // head
    ctx.beginPath(); ctx.arc(cx, py + tile * 0.24, tile * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = shade("#e0b888", b); ctx.fill();
    // a gold coin glint (marks it as the merchant, not just any figure)
    ctx.beginPath(); ctx.arc(cx + tile * 0.16, cy - tile * 0.02, tile * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = shade("#f0c14b", b); ctx.fill();
  }
  // A fountain: a stone basin with a gently bobbing water surface.
  function drawFountain(px, py, b, now) {
    const cx = px + tile / 2, cy = py + tile * 0.62;
    const bob = Math.sin(now / 400 + (px + py)) * tile * 0.02;
    ctx.fillStyle = shade("#6a6a72", b);
    ctx.beginPath(); ctx.ellipse(cx, cy, tile * 0.32, tile * 0.20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade("#7ec8d8", b);
    ctx.beginPath(); ctx.ellipse(cx, cy + bob, tile * 0.24, tile * 0.13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = shade("#c8d8dc", b); ctx.lineWidth = Math.max(1, tile * 0.05);
    ctx.beginPath(); ctx.ellipse(cx, cy + bob, tile * 0.24, tile * 0.13, 0, 0, Math.PI * 2); ctx.stroke();
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
  // How far through an effect we are, clamped to 0..1. requestAnimationFrame hands
  // the frame's START timestamp, which can be EARLIER than the performance.now()
  // an effect stamped itself with inside the input handler that spawned it — so a
  // brand-new effect gets a NEGATIVE age on its first frame. Unclamped that runs
  // radii and tweens backwards past their start, and canvas throws outright on a
  // negative arc radius ("The radius provided (-0.23) is negative"), which kills
  // the whole frame.
  const anim01 = (now, at, dur) => Math.min(1, Math.max(0, (now - at) / dur));
  let floaters = [];
  // Anything faster than speed 1 banks enough energy to act twice in a single
  // worldTurn — a bat (speed 1.1) does it about every tenth turn — and both acts
  // resolve before a frame is ever drawn. Tweening straight from where it started
  // to where it finished cuts the corner: two legal steps around a tree render as
  // one diagonal glide straight through it, which reads as a monster teleporting
  // through walls. So a turn that moves an entity more than once records the tiles
  // it actually visited (`e.wp`), and the tween walks them a leg at a time.
  // A charge is untouched: it covers several tiles in ONE act, really does travel
  // in a straight line, and sets its own `moveMs` for the longer slide.
  function animEntity(e, now) {
    if (e.rx === undefined) {
      e.rx = e.x; e.ry = e.y; e.ax = e.x; e.ay = e.y; e.tx = e.x; e.ty = e.y; e.at = 0;
    }
    if (reduceMotion) { e.rx = e.x; e.ry = e.y; e.tx = e.x; e.ty = e.y; e.wp = null; return; }
    const dur = (e.wp && e.wp.length && e.legMs) ? e.legMs : (e.moveMs || MOVE_MS);
    if (e.wp && e.wp.length) {
      // Mid multi-step turn: only start the next leg once this one has played out,
      // so the path is drawn tile by tile instead of as one straight line.
      if (now - e.at >= dur) {
        e.ax = e.tx; e.ay = e.ty;
        const next = e.wp.shift();
        e.tx = next[0]; e.ty = next[1];
        e.at = now;
        if (!e.wp.length) e.legMs = 0;    // last leg played — back to normal timing
      }
    } else if (e.tx !== e.x || e.ty !== e.y) {
      // Ordinary single move — retarget immediately from wherever we're drawn, so
      // fast play stays responsive rather than queueing up lag.
      e.ax = e.rx; e.ay = e.ry; e.tx = e.x; e.ty = e.y; e.at = now;
    }
    const k = easeOut(anim01(now, e.at, dur));
    e.rx = e.ax + (e.tx - e.ax) * k;
    e.ry = e.ay + (e.ty - e.ay) * k;
    if (k >= 1 && e.moveMs && !(e.wp && e.wp.length)) e.moveMs = 0;   // one-off slow slide done
  }
  function bumpOffset(e, now) {
    if (reduceMotion || !e.bumpAt) return [0, 0];
    const p = anim01(now, e.bumpAt, BUMP_MS);
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
    player.tx = player.x; player.ty = player.y; player.wp = null;
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

  // Boss playbooks live in bosses.js (a self-contained module) — wire it up
  // here, after flash/floatText/etc. above so every dep it needs already
  // exists (map/monsters/dead are reassigned wholesale elsewhere in this file,
  // so those three go in as accessors rather than snapshot values).
  const _boss = window.CantoriBosses({
    getMap: () => map, getMonsters: () => monsters, isDead: () => dead,
    player, WALL, attack, canSee, chaseLastSeen, cheb, computeFOV, die, flash, flashScreen,
    floatText, inBounds, lineOfSight, log, monsterAt, patrolStep, randInt, sayMonster, shuns,
    snapEntity, snapPlayer, spawnBurst, spawnNear, spawnProjectile, spawnStreak, stepMonsterTo,
    tileProp, updateHUD, normalAct: defaultAct,
  });

  // ---- Draw: dungeon view --------------------------------------------------
  function hitFlash(e, px, py, now) {
    if (!e.hitAt) return;
    const p = anim01(now, e.hitAt, HIT_MS);
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
          else if (t === WATER) drawWater(px, py, b);
          else if (t === CHASM) drawChasm(px, py, b);
          else if (t === RUBBLE) drawRubble(px, py, b);
          else if (t === GRASS) drawGrass(px, py, b);
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
    // merchant floor fixtures (wall-mounted, same convention as torches)
    if (shopKeeper && inBounds(shopKeeper.x, shopKeeper.y) && explored[shopKeeper.y][shopKeeper.x]) {
      drawShopkeeper(SX(shopKeeper.x), SY(shopKeeper.y), visible[shopKeeper.y][shopKeeper.x] ? litBright(shopKeeper.x, shopKeeper.y) : MEM);
    }
    if (fountain && inBounds(fountain.x, fountain.y) && explored[fountain.y][fountain.x]) {
      drawFountain(SX(fountain.x), SY(fountain.y), visible[fountain.y][fountain.x] ? litBright(fountain.x, fountain.y) : MEM, now);
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
      if (it.boonKey) drawBoonRune(px, py, ((DATA.boons || {})[it.boonKey] || {}).color || "#f0c14b", now);
      else if (it.key === "gold") drawCoin(px, py);
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

    // golem windup telegraph: a pulsing amber cone (slam) or aim line (boulder)
    for (const m of monsters) {
      if (!m.windup || m.hp <= 0) continue;
      const pulse = 0.30 + 0.24 * Math.abs(Math.sin(now / 110));
      let tiles = m.windup.tiles;
      if (!tiles) {
        tiles = []; let x = m.x, y = m.y;
        for (let i = 0; i < 24; i++) {
          const nx = x + m.windup.dx, ny = y + m.windup.dy;
          if (!inBounds(nx, ny) || map[ny][nx] === WALL) break;
          x = nx; y = ny; tiles.push([x, y]);
          if (x === player.x && y === player.y) break;
        }
      }
      for (const [x, y] of tiles) {
        if (!inBounds(x, y) || !visible[y][x]) continue;
        const px = SX(x), py = SY(y);
        ctx.fillStyle = "rgba(224,152,40," + pulse.toFixed(3) + ")";
        ctx.fillRect(px, py, tile, tile);
        ctx.strokeStyle = "rgba(255,200,120,0.9)"; ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, tile - 2, tile - 2);
      }
    }

    // monsters (glide + lunge + flash; bosses render larger)
    for (const m of monsters) {
      if (m.hp <= 0 || !inBounds(m.x, m.y) || !visible[m.y][m.x]) continue;
      if (tileProp(m.x, m.y, "conceals") && cheb(m.x, m.y, player.x, player.y) > 1) continue;   // tall grass hides it until you're beside it
      const [bx, by] = bumpOffset(m, now);
      const px = SX(m.rx + bx), py = SY(m.ry + by);
      if (!drawSpriteFit(SPRITES[m.type], px, py, m.boss ? 1.5 : 1)) {
        const v = VERMIN[m.type];   // no sprite file for this type — fall back to its glyph
        drawGlyphInto(ctx, px, py, tile, v ? v.glyph : "?", v ? v.color : "#c0c0c0");
      }
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
      const p = anim01(now, pr.at, pr.dur);
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
      const p = anim01(now, bt.at, bt.dur);
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
      const p = anim01(now, s.at, s.dur);
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
      const p = anim01(now, s.at, s.dur);
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
      const p = anim01(now, f.at, FLOAT_MS);
      const fx = SX(f.x) + tile / 2, fy = SY(f.y) + tile / 2 - p * tile * 0.9;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(f.text, fx + 1, fy + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, fx, fy);
    }
    ctx.globalAlpha = 1;

    // monster speech: a taunt in a small dark bubble above the speaker
    for (const s of speeches) {
      const m = s.m; if (!m || m.hp <= 0) continue;
      const p = anim01(now, s.at, SPEECH_MS);
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
      const p = anim01(now, screenFlash.at, screenFlash.dur);
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
        else if (t === WATER) { mctx.fillStyle = been ? "#3a6a9a" : "#1e3a52"; mctx.fillRect(px, py, sz, sz); }
        else if (t === CHASM) { mctx.fillStyle = been ? "#1a1a1e" : "#0c0c0e"; mctx.fillRect(px, py, sz, sz); }
        else if (t === RUBBLE) { mctx.fillStyle = been ? "#8a8578" : "#4e4a40"; mctx.fillRect(px, py, sz, sz); }
        else if (t === GRASS) { mctx.fillStyle = been ? "#4a7a3a" : "#2a4520"; mctx.fillRect(px, py, sz, sz); }
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
    pendingUpgrade = false;   // opening or closing the pack cancels any in-progress target pick
    if (invOpen) { selectedInvIdx = -1; selectedEquip = null; toggleMap(false); toggleChar(false); toggleExamine(false); renderInv(); }
    document.getElementById("inv").hidden = !invOpen;
    document.getElementById("btnBag").classList.toggle("on", invOpen);
  }

  // ---- Merchant floor: shopkeeper (buy/sell) + fountain (full heal) --------
  let shopOpen = false;
  let fountainOpen = false;
  function toggleShop(force) {
    shopOpen = force === undefined ? !shopOpen : force;
    if (shopOpen) { toggleMap(false); toggleChar(false); toggleInv(false); toggleExamine(false); renderShop(); }
    const el = document.getElementById("shop");
    if (el) el.hidden = !shopOpen;
  }
  function renderShop() {
    document.getElementById("shopGold").textContent = player.gold + " gold";
    const stockHost = document.getElementById("shopStock");
    stockHost.innerHTML = "";
    const potions = shopStock.filter(Boolean);
    if (!potions.length) stockHost.innerHTML = '<div class="shop-empty">Sold out.</div>';
    shopStock.forEach((key, i) => {
      if (!key) return;
      const def = CONSUM[key];
      const row = document.createElement("div");
      row.className = "shop-row";
      const canAfford = player.gold >= SHOP_POTION_PRICE && player.inv.length < INV_MAX;
      if (!canAfford) row.classList.add("disabled");
      const ic = document.createElement("span"); ic.className = "s-ic";
      const cv = document.createElement("canvas"); cv.width = 48; cv.height = 48;
      const cc = cv.getContext("2d"); cc.imageSmoothingEnabled = false;
      drawGlyphInto(cc, 0, 0, 48, def.glyph || "!", def.color || "#cfc3a0");
      ic.appendChild(cv);
      const nm = document.createElement("span"); nm.className = "s-name"; nm.textContent = def.name;
      const pr = document.createElement("span"); pr.className = "s-price"; pr.textContent = SHOP_POTION_PRICE + "g";
      row.appendChild(ic); row.appendChild(nm); row.appendChild(pr);
      row.addEventListener("click", () => buyPotion(i));
      stockHost.appendChild(row);
    });
    const sellHost = document.getElementById("shopSell");
    sellHost.innerHTML = "";
    const sellable = [];
    player.inv.forEach((it, i) => { if (isGear(it)) sellable.push({ it, i }); });
    if (!sellable.length) sellHost.innerHTML = '<div class="shop-empty">Nothing in your pack to sell.</div>';
    for (const { it, i } of sellable) {
      const row = document.createElement("div");
      row.className = "shop-row";
      const ic = document.createElement("span"); ic.className = "s-ic";
      const cv = document.createElement("canvas"); cv.width = 48; cv.height = 48;
      const cc = cv.getContext("2d"); cc.imageSmoothingEnabled = false;
      renderIconInto(cc, 0, 0, 48, it);
      ic.appendChild(cv);
      const nm = document.createElement("span"); nm.className = "s-name"; nm.textContent = itemName(it);
      const pr = document.createElement("span"); pr.className = "s-price"; pr.textContent = sellPrice(it) + "g";
      row.appendChild(ic); row.appendChild(nm); row.appendChild(pr);
      row.addEventListener("click", () => sellGear(i));
      sellHost.appendChild(row);
    }
  }
  function buyPotion(slot) {
    const key = shopStock[slot];
    if (!key) return;
    if (player.gold < SHOP_POTION_PRICE) { log("Not enough gold."); return; }
    if (!invAdd({ key, count: 1 })) { log("Your pack is full."); return; }
    player.gold -= SHOP_POTION_PRICE;
    log("You buy a " + CONSUM[key].name + ".");
    shopStock[slot] = weightedShopPotionKey();   // the stall restocks the slot immediately
    renderShop();
    updateHUD();
  }
  function sellGear(idx) {
    const it = player.inv[idx];
    if (!it || !isGear(it)) return;
    const price = sellPrice(it);
    player.gold += price;
    player.inv.splice(idx, 1);
    log("You sell the " + itemName(it) + " for " + price + " gold.");
    renderShop();
    updateHUD();
  }
  function toggleFountain(force) {
    fountainOpen = force === undefined ? !fountainOpen : force;
    if (fountainOpen) { toggleMap(false); toggleChar(false); toggleInv(false); toggleExamine(false); toggleShop(false); renderFountain(); }
    const el = document.getElementById("fountain");
    if (el) el.hidden = !fountainOpen;
  }
  function renderFountain() {
    const sub = document.getElementById("fountainSub");
    const acts = document.getElementById("fountainActions");
    acts.innerHTML = "";
    if (player.hp >= player.maxHp) {
      sub.textContent = "The water shimmers, but you're already at full health.";
    } else {
      sub.textContent = "Drink for a full heal — " + shopHealCost + " gold?";
      const buy = mkBtn("Drink (" + shopHealCost + "g)", "primary", useFountain);
      if (player.gold < shopHealCost) buy.disabled = true;
      acts.appendChild(buy);
    }
    acts.appendChild(mkBtn("Leave", "", () => toggleFountain(false)));
  }
  function useFountain() {
    if (player.gold < shopHealCost || player.hp >= player.maxHp) return;
    player.gold -= shopHealCost;
    player.hp = player.maxHp;
    log("You drink from the fountain and feel fully restored.", "hit");
    updateHUD();
    toggleFountain(false);
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
  let pendingUpgrade = false;  // a Scroll of Upgrade is armed, awaiting a target item
  const EQUIP_ROWS = [["Weapon", "weapon"], ["Armor", "armor"], ["Ring", "ring1"], ["Ring", "ring2"], ["Trinket", "trinket"], ["Necklace", "necklace"]];
  const entryDef = (e) => (isGear(e) ? GEAR[e.key] : CONSUM[e.key]);
  const entryGlyph = (e) => { const d = entryDef(e); return (d && d.glyph) || "?"; };
  const entryColor = (e) => (isGear(e) ? itemColor(e) : consumColor(e.key));
  const entryName = (e) => (isGear(e) ? itemName(e) : displayName(e.key));
  function renderInv() {
    document.getElementById("invGold").textContent = player.gold + " gold";
    const df = defRange(armorDefMin(), armorDefMax());
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
    // A Scroll of Upgrade is armed → the next equipped slot or gear item tapped
    // is the candidate; show it with a Confirm/Cancel prompt instead of its
    // normal actions, and consume nothing until Confirm is pressed.
    if (pendingUpgrade) {
      const raw = selectedEquip ? player[selectedEquip] : (isGear(player.inv[selectedInvIdx]) ? player.inv[selectedInvIdx] : null);
      const target = (raw && GEAR[raw.key].cat !== "trinket") ? raw : null;   // trinkets can't be upgraded
      const acts = document.createElement("div"); acts.className = "inv-actions";
      if (!target) {
        d.innerHTML = '<div class="d-empty">Choose an equipped weapon, armor, ring, or necklace to upgrade. (Trinkets can\'t be upgraded.)</div>';
        acts.appendChild(mkBtn("Cancel", "danger", () => { pendingUpgrade = false; renderInv(); }));
        d.appendChild(acts);
        return;
      }
      d.innerHTML = detailHeaderHTML(target) + `<div class="d-sub" style="margin-top:6px">Upgrade to +${(target.plus || 0) + 1}?</div>`;
      acts.appendChild(mkBtn("Confirm", "primary", () => confirmUpgrade(target)));
      acts.appendChild(mkBtn("Cancel", "danger", () => { pendingUpgrade = false; selectedInvIdx = -1; selectedEquip = null; renderInv(); }));
      d.appendChild(acts);
      return;
    }
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
    const unmet = isGear(e) ? gearReqUnmet(e) : null;
    d.innerHTML = detailHeaderHTML(e) + (unmet ? `<div class="d-sub" style="color:#e0705a">Requires ${unmet.need} ${unmet.stat} (have ${unmet.have})</div>` : "");
    const acts = document.createElement("div"); acts.className = "inv-actions";
    const other = isGear(e) ? "Equip" : def.cat === "potion" ? "Drink" : def.cat === "scroll" ? "Read" : "Use";
    const eqBtn = mkBtn(other, "primary", () => actItem(selectedInvIdx));
    if (unmet) { eqBtn.disabled = true; eqBtn.style.opacity = "0.5"; }
    acts.appendChild(eqBtn);
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
    player.maxMp = computeMaxMp(); player.mp = Math.min(player.mp, player.maxMp);
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
    player.maxMp = computeMaxMp(); player.mp = Math.min(player.mp, player.maxMp);
    updateHUD(); worldTurn();
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  function actItem(idx) {
    const it = player.inv[idx];
    if (!it) return;
    if (isGear(it)) equipItem(idx);
    else if (CONSUM[it.key] && CONSUM[it.key].effect === "upgrade_item") beginUpgrade();
    else useConsumable(idx);
  }
  // Scroll of Upgrade: arms target-picking mode instead of applying at once —
  // the next equipped slot or inventory gear item tapped becomes the candidate,
  // shown with a Confirm/Cancel prompt in the detail panel (see renderInvDetail).
  function beginUpgrade() {
    pendingUpgrade = true;
    selectedInvIdx = -1; selectedEquip = null;
    log("Scroll of Upgrade — choose an equipped weapon, armor, ring, or necklace.");
    renderInv();
  }
  function confirmUpgrade(target) {
    target.plus = (target.plus || 0) + 1;
    const sIdx = player.inv.findIndex((i) => i.key === "scroll_upgrade");   // re-found by key: robust to any index drift
    if (sIdx >= 0) takeOne(sIdx);
    log("The scroll's magic seeps into your " + itemName(target) + ". (+" + target.plus + ")", "hit");
    floatText(player.x, player.y, "+1", "#f0c14b");
    pendingUpgrade = false;
    selectedInvIdx = -1; selectedEquip = null;
    player.maxMp = computeMaxMp(); player.mp = Math.min(player.mp, player.maxMp);   // Scribe's Intellect scales with gear quality
    updateHUD();
    worldTurn();
    if (dead) { toggleInv(false); return; }
    renderInv();
  }
  function equipItem(idx) {
    const it = player.inv[idx];
    if (!it || !isGear(it)) return;
    const unmet = gearReqUnmet(it);
    if (unmet) { log("You need " + unmet.need + " " + unmet.stat + " to use the " + itemName(it) + " (have " + unmet.have + ")."); return; }
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
    player.maxMp = computeMaxMp();               // INT affixes/quality bonuses can change max MP
    player.mp = Math.min(player.mp, player.maxMp);
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
    const wasUnidentified = !identified.has(it.key);
    identified.add(it.key);      // using an item reveals what it is
    if (wasUnidentified) log("It was a " + (def.name || it.key) + "!", "hit");
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
      if (passable(x, y) && !shuns(x, y) && !itemAt(x, y)) return { x, y };
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
        addPoison(m, 2);
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
      // Rolls 90%–150% of max HP total. Only up to VIT of that heals THIS turn —
      // the rest pools into a heal-over-time queue that ticks up to VIT more per
      // turn (see healQueueTick), so a big potion doesn't instantly top you off.
      const total = Math.round(player.maxHp * (0.9 + Math.random() * 0.6));
      const cap = Math.max(1, eff("VIT"));
      const now = Math.min(total, cap, player.maxHp - player.hp);
      player.hp += now;
      const queued = Math.max(0, total - now);
      player.healPending = (player.healPending || 0) + queued;
      log("You drink a Potion of Healing. (+" + now + (queued ? ", +" + queued + " queued to heal over time" : "") + ")", "hit");
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
      const before = player.maxMp;
      player.stats.INT += 1;
      player.maxMp = computeMaxMp();
      player.mp += Math.max(0, player.maxMp - before);   // the freshly-gained MP is granted too
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
      if (player.boons && player.boons.has("leper")) {
        log("Your body shrugs off the poison — Maelon's Leper Colony holds.", "hit");
      } else {
        const amt = randInt(4, 8);
        player.hp -= amt;
        log("It was poison! (-" + amt + ")", "hurt");
        if (player.hp <= 0) die();
      }
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
  let charSelSkill = null;   // id of the node selected in the Skills tree, or null

  // ---- Skills --------------------------------------------------------------
  // Usable skills are built from the class's skill tree: a flat list of nodes,
  // each with a stable `id` and grid-ish `x`/`y` layout coordinates. A node
  // becomes a real skill once it carries a `ranks` array (per-level mechanics);
  // nodes with only description text are authoring scaffold and are skipped.
  // `kind` picks the behavior: "rush" (directional dash), "spin" (area strike),
  // or "passive" (a continuous modifier). Passives may set `when` = a weapon
  // subtype they require.
  // Falls back to a class's legacy `skills` map if the tree wires nothing yet.

  // Trees were once a fixed 5×5 grid, and a prerequisite named a cell by its
  // [tier, slot] coordinate. The grid was the only thing stopping trees from
  // being real trees: a coordinate can only point at a cell that exists in the
  // row above, so a node with two parents from different rows, a diamond, or two
  // branches of unequal depth were all inexpressible. Nodes carry ids instead,
  // and prerequisites name ids.
  //   node = { id, x, y, name, icon, kind, when, desc, levels, ranks,
  //            req: ["id", …], reqAny: [["id", minRank], …] }
  // `key` is accepted as an alias for `id` — the runtime skill keys that
  // player.skills, the hotbar and the dev hooks are keyed by never changed; only
  // the way prerequisites address each other did.
  //
  // normalizeTree accepts EITHER shape and always hands back the flat one. It is
  // cheap and it stays forever: editor.html rewrites data.js wholesale, so a
  // stale draft in localStorage — or an old data.js out of git history — must
  // still open rather than brick the Skills tab.
  const TREE_COLS = 5;   // only a fallback layout width, for nodes authored without x/y
  const skillSlug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  function normalizeTree(raw) {
    if (!Array.isArray(raw)) return [];
    const nodes = [], byPos = {};
    if (raw.some((row) => Array.isArray(row))) {   // old shape: rows of cells, blanks are null
      raw.forEach((tier, y) => (Array.isArray(tier) ? tier : []).forEach((cell, x) => {
        if (!cell || !cell.name) return;
        const n = Object.assign({}, cell);
        n.id = n.id || n.key || skillSlug(n.name);
        n.x = x; n.y = y;                          // the grid WAS the layout — keep it as-is
        byPos[y + "," + x] = n.id;
        nodes.push(n);
      }));
    } else {
      // A node written by hand may omit its coordinates; lay those out in reading
      // order so the tree still draws as something rather than stacking at 0,0.
      raw.forEach((cell, i) => {
        if (!cell || !(cell.id || cell.key || cell.name)) return;
        const n = Object.assign({}, cell);
        n.id = n.id || n.key || skillSlug(n.name);
        n.x = typeof n.x === "number" ? n.x : i % TREE_COLS;
        n.y = typeof n.y === "number" ? n.y : (i / TREE_COLS) | 0;
        nodes.push(n);
      });
    }
    // Canonicalize prerequisites so everything downstream sees exactly one shape:
    // both req and reqAny become [["id", minRank], …]. An entry may arrive as an
    // old [tier, slot(, minRank)] coordinate (numbers), a bare "id", or ["id"]
    // with the rank left implicit — all three mean the same thing, rank 1. A rank
    // of the string "max" means that skill's own top rank, so a gate authored as
    // "maxed out" stays maxed out if the skill later gains a fifth rank. A
    // reference that resolves to nothing keeps an empty id, so the node stays
    // locked exactly as it did when a coordinate pointed at a blank cell.
    const toRef = (r) => {
      if (typeof r === "string") return [r, 1];
      if (!Array.isArray(r) || !r.length) return null;
      if (typeof r[0] === "number") return [byPos[r[0] + "," + r[1]] || "", r[2] || 1];
      return [String(r[0] || ""), r[1] || 1];
    };
    for (const n of nodes) {
      n.req = (n.req || []).map(toRef).filter(Boolean);
      n.reqAny = (n.reqAny || []).map(toRef).filter(Boolean);
    }
    return nodes;
  }
  let _skillCache = { cls: null, skills: {}, byId: {} };
  function treeSkills(cls) {
    if (_skillCache.cls === cls) return _skillCache;
    const c = DATA.classes[cls] || {};
    const skills = {}, byId = {};
    for (const n of normalizeTree(c.skillTree)) {
      byId[n.id] = n;                              // every node, wired or scaffold — the graph index
      if (!n.name || !Array.isArray(n.ranks) || !n.ranks.length) continue;
      skills[n.id] = {
        name: n.name, icon: n.icon || "✦", desc: n.desc || "",
        kind: n.kind || "passive", when: n.when || null,
        max: n.ranks.length, ranks: n.ranks, levels: n.levels || [],
        req: n.req || [], reqAny: n.reqAny || [], reqPoints: n.reqPoints || 0,
        minLevel: n.minLevel || 0, pos: { x: n.x, y: n.y },
      };
    }
    if (!Object.keys(skills).length && c.skills) {   // legacy: a class that still lists skills directly
      for (const k of Object.keys(c.skills)) skills[k] = Object.assign({ kind: k, when: null, levels: [], req: [], pos: null }, c.skills[k]);
    }
    _skillCache = { cls, skills, byId };
    return _skillCache;
  }
  // Active abilities unlocked by a boon (not part of the class skill tree). Each
  // entry maps a skill key -> { boon: which boon unlocks it, skill: the skill def }.
  // grantBoonSkills() wires the matching ones into player.skills when a boon is
  // picked; classSkills() folds them into the tree so the rest of the UI (hotbar,
  // number-key hotkeys, cooldowns) treats them exactly like a learned skill.
  const BOON_SKILLS = {
    speed_of_light: { boon: "speed_of_light", skill: {
      name: "Speed of Light", icon: "⚡", kind: "sol", max: 1, ranks: [{}],
      levels: ["25 MP — instant +100% Haste, decaying 1%/turn back to baseline. Cooldown 500 turns."],
      desc: "The world slows around you — an instant, decaying burst of Haste.",
    } },
    wall_of_faith: { boon: "wall", skill: {
      name: "Wall of Faith", icon: "🧱", kind: "wallcast", max: 1, ranks: [{}],
      levels: ["Tap a tile — raise a 5-tile wall of stone along the nearest axis, shoving any foe caught in it back a step. Cooldown 150 turns."],
      desc: "Raise a wall of stone, knocking back whatever stands in its way.",
    } },
    faiths_pull: { boon: "pull", skill: {
      name: "Faith's Pull", icon: "🌀", kind: "pullcast", max: 1, ranks: [{}],
      levels: ["Tap a tile — for 5 turns, every aware foe within a 9×9 aura paths toward its center instead of you. Cooldown 150 turns."],
      desc: "Bend the ground to Kethara's will, pulling foes toward one spot.",
    } },
    eye_of_kethara: { boon: "eye", skill: {
      name: "Eye of Kethara", icon: "👁", kind: "eyecast", max: 1, ranks: [{}],
      levels: ["Tap a foe — immobilize it for 25 turns. Cooldown 100 − RES."],
      desc: "Fix a foe in place, unable to move or act.",
    } },
    anger_of_kethara: { boon: "anger", skill: {
      name: "Anger of Kethara", icon: "😡", kind: "angercast", max: 1, ranks: [{}],
      levels: ["Tap a foe — berserk it for 10 turns; it turns on whatever's nearest, not just you. Cooldown 100 − RES."],
      desc: "Send a foe into a berserk rage against everything around it.",
    } },
  };
  function grantBoonSkills(boonKey) {
    for (const sk of Object.keys(BOON_SKILLS)) {
      if (BOON_SKILLS[sk].boon === boonKey) {
        player.skills[sk] = { rank: 1, cd: 0 };
        log("You gain " + BOON_SKILLS[sk].skill.name + " — an activated ability.", "hit");
      }
    }
  }
  function classSkills() {
    const base = treeSkills(player.cls).skills;
    if (!player.boons || !player.boons.size) return base;
    const out = Object.assign({}, base);
    for (const sk of Object.keys(BOON_SKILLS)) if (player.boons.has(BOON_SKILLS[sk].boon)) out[sk] = BOON_SKILLS[sk].skill;
    return out;
  }
  function skillDef(key) { return classSkills()[key]; }
  function skillCur(key) { const st = player.skills[key], d = skillDef(key); return st && st.rank > 0 ? d.ranks[st.rank - 1] : null; }
  // req: every listed [id, minRank] must be at minRank — an AND.
  // reqAny: at least ONE listed [id, minRank] must reach minRank (default 1) —
  // an OR, used for things like "4 points in any one of the first-tier skills."
  // normalizeTree() has already rewritten both into these canonical id forms, so
  // there is one lookup here whichever shape the tree was authored in, and a
  // prerequisite can name any node in the tree rather than only a grid neighbour.
  // Total points sunk into this class's tree. player.statPoints is what's UNSPENT,
  // which is the opposite of what a "12 points in the tree" gate wants.
  const skillPointsSpent = () => Object.keys(player.skills || {}).reduce((n, k) => n + (player.skills[k].rank || 0), 0);
  // How many ranks a prerequisite reference actually demands. "max" means the
  // required skill's own top rank, so "Spin, maxed" survives Spin gaining a rank.
  function reqRank(id, minRank) {
    if (minRank !== "max") return minRank || 1;
    const sk = classSkills();
    return sk[id] ? sk[id].max : 1;
  }
  const refMet = ([id, minRank]) => { const st = player.skills[id]; return !!(st && st.rank >= reqRank(id, minRank)); };
  function prereqsMet(d) {
    if (d.reqPoints && skillPointsSpent() < d.reqPoints) return false;   // a deep-tree gate, not a named prerequisite
    if (d.minLevel && player.level < d.minLevel) return false;           // a node the character grows into, not one they earn
    const req = d.req || [];
    if (req.length && !req.every(refMet)) return false;
    const reqAny = d.reqAny || [];
    if (reqAny.length) return reqAny.some(refMet);
    return true;
  }
  function prereqNames(d) {
    const sk = classSkills();
    // A lock has to say what would open it — "Spin" and "Spin, maxed" are very
    // different asks, and a player who can't tell them apart assumes a bug.
    const refName = ([id, minRank]) => {
      const nm = sk[id] ? sk[id].name : null;
      if (!nm) return null;
      const need = reqRank(id, minRank);
      return need <= 1 ? nm : nm + (minRank === "max" || (sk[id] && need >= sk[id].max) ? ", maxed" : " (rank " + need + ")");
    };
    const names = (d.req || []).map(refName).filter(Boolean);
    if (d.reqPoints) names.unshift(d.reqPoints + " points spent in the tree (you have " + skillPointsSpent() + ")");
    if (d.minLevel) names.unshift("character level " + d.minLevel + " (you are " + player.level + ")");
    const reqAny = d.reqAny || [];
    if (reqAny.length) {
      const parts = reqAny.map(refName).filter(Boolean);
      if (parts.length) names.push(parts.join(" or "));
    }
    return names;
  }
  // Sum a passive-skill modifier (dmg/acc/eva/…) across learned passives whose
  // condition (`when` = required weapon subtype, or "unarmed" = no weapon at all)
  // currently holds.
  function passiveMod(field) {
    let v = 0; const sk = classSkills();
    for (const key in sk) {
      const d = sk[key]; if (d.kind !== "passive") continue;
      const st = player.skills[key]; if (!st || st.rank < 1) continue;
      if (d.when === "unarmed") { if (player.weapon) continue; }
      else if (d.when && d.when !== weaponSub()) continue;
      const r = d.ranks[st.rank - 1] || {}; if (r[field] != null) v += r[field];
    }
    return v;
  }
  // Brynn's Unarmed Master, rank 4: bare-fisted damage also scales with
  // (DEX+VIT)/2, riding along the min/max bonus above.
  function unarmedStatBonus() {
    if (player.weapon) return 0;
    const st = player.skills.unarmed_master; if (!st || st.rank < 1) return 0;
    const d = classSkills().unarmed_master; if (!d) return 0;
    const r = d.ranks[st.rank - 1];
    return (r && r.statScale) ? Math.floor((eff("DEX") + eff("VIT")) / 2) : 0;
  }

  function learnSkill(key) {
    const d = skillDef(key), st = player.skills[key];
    if (!d || !st || st.rank >= d.max || player.statPoints <= 0) return;
    if (!prereqsMet(d)) { log("Requires " + (prereqNames(d).join(", ") || "a prerequisite") + " first.", ""); return; }
    const nextDef = d.ranks[st.rank];
    if (nextDef && nextDef.minLevel && player.level < nextDef.minLevel) { log("Requires character level " + nextDef.minLevel + " first.", ""); return; }
    player.statPoints--; st.rank++;
    log((st.rank === 1 ? "Learned " : "Upgraded ") + d.name + " (rank " + st.rank + ").", "hit");
    renderChar(); updateHotbar();
  }
  function useSkill(key) {
    if (dead || mapOpen || invOpen || charOpen || boonPending || classPending) return;
    const st = player.skills[key], d = skillDef(key);
    if (!st || st.rank < 1 || !d) return;
    if (d.kind === "passive") { log(d.name + " is always active.", ""); return; }
    if (st.cd > 0) { log(d.name + " is on cooldown (" + st.cd + ").", ""); return; }
    if (d.kind === "rush") beginRush(key);
    else if (d.kind === "spin") executeSpin(key);
    else if (d.kind === "sol") executeSpeedOfLight(key);
    else if (d.kind === "wallcast" || d.kind === "pullcast" || d.kind === "eyecast" || d.kind === "angercast" || d.kind === "smite" || d.kind === "throwmon") beginTargetedSkill(key);
  }
  // Ourn's Speed of Light: 25 MP for an instant, decaying burst of Haste.
  function executeSpeedOfLight(key) {
    const cost = 25;
    if (player.mp < cost) { log("Not enough MP for Speed of Light (need " + cost + ")."); return; }
    player.mp -= cost;
    player.hasteBuff = 101;   // +1: this cast's own worldTurn() below ticks it once already
    flashScreen("#ffe08a", 320); floatText(player.x, player.y, "⚡", "#ffe08a");
    log("Speed of Light — the world slows around you. (+100% Haste, decaying)", "hit");
    player.skills[key].cd = 500;
    updateHUD(); updateHotbar();
    worldTurn();
  }
  // Arm a tap-a-target boon ability (wall/pull/eye/anger) — the next tap on the
  // board (walkTo) resolves it, same targeting UX as Rush's "choose a direction".
  function beginTargetedSkill(key) {
    pendingSkill = pendingSkill === key ? null : key;
    const d = skillDef(key);
    log(pendingSkill ? d.name + " — tap a target." : d.name + " cancelled.");
    updateHotbar();
  }
  // Kethara's Wall of Faith: 5 tiles of stone along whichever axis (horizontal or
  // vertical) most closely matches the direction to the tapped tile. Any monster
  // caught on a cell is shoved back a step first, then the wall rises beneath it;
  // a cell that can't be cleared is skipped (never traps a monster inside rock).
  function executeWallOfFaith(key, tx, ty) {
    pendingSkill = null;
    const dx = tx - player.x, dy = ty - player.y;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    let built = 0;
    for (let i = -2; i <= 2; i++) {
      const x = horiz ? tx + i : tx, y = horiz ? ty : ty + i;
      if (!inBounds(x, y) || map[y][x] !== FLOOR) continue;
      const m = monsterAt(x, y);
      if (m) {
        const pdx = Math.sign(x - player.x) || (horiz ? 0 : 1), pdy = Math.sign(y - player.y) || (horiz ? 1 : 0);
        const nx = x + pdx, ny = y + pdy;
        if (inBounds(nx, ny) && passableFor(m, nx, ny) && !shuns(nx, ny) && !monsterAt(nx, ny)) { m.x = nx; m.y = ny; floatText(nx, ny, "knock!", "#b491d6"); }
        else continue;
      }
      activeWalls.push({ x, y, turns: 21 });   // +1: this cast's own worldTurn() below ticks it once already
      map[y][x] = WALL;
      built++;
    }
    if (!built) { log("Kethara's wall finds no purchase there."); updateHotbar(); return; }
    computeFOV();
    log("Kethara raises a wall of faith.", "hit");
    player.skills[key].cd = 150;
    updateHotbar();
    worldTurn();
  }
  // Kethara's Faith's Pull: for 5 turns, every aware monster within a 9×9 aura
  // (Chebyshev distance ≤4) centered on the tapped tile paths toward its center.
  function executeFaithsPull(key, tx, ty) {
    pendingSkill = null;
    pullZone = { x: tx, y: ty, turns: 6 };   // +1: this cast's own worldTurn() below ticks it once already
    floatText(tx, ty, "🌀", "#b491d6");
    log("Kethara's faith pulls the ground taut around that spot.", "hit");
    player.skills[key].cd = 150;
    updateHotbar();
    worldTurn();
  }
  // Kethara's Eye of Kethara: immobilize a targeted monster for 25 turns (reuses
  // the existing stun mechanic — a stunned monster skips its turn entirely).
  function executeEyeOfKethara(key, tx, ty) {
    pendingSkill = null;
    const m = monsterAt(tx, ty);
    if (!m || m.hp <= 0) { log("No target there."); updateHotbar(); return; }
    m.stun = Math.max(m.stun || 0, 25);
    floatText(m.x, m.y, "◉", "#b491d6");
    log("Kethara's Eye fixes upon the " + monName(m) + " — it cannot move.", "hit");
    player.skills[key].cd = Math.max(0, 100 - eff("RES"));
    updateHotbar();
    worldTurn();
  }
  // Kethara's Anger of Kethara: berserk a targeted monster for 10 turns.
  const ANGER_TURNS = 10;
  function executeAngerOfKethara(key, tx, ty) {
    pendingSkill = null;
    const m = monsterAt(tx, ty);
    if (!m || m.hp <= 0) { log("No target there."); updateHotbar(); return; }
    m.berserk = ANGER_TURNS; m.aware = true; m.lastSeen = { x: player.x, y: player.y }; m.searching = false;
    floatText(m.x, m.y, "😡", "#e0685a");
    log("Kethara's Anger consumes the " + monName(m) + " — it turns on everything nearby.", "hit");
    player.skills[key].cd = Math.max(0, 100 - eff("RES"));
    updateHotbar();
    worldTurn();
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
  // Smite: a single devastating blow scaling with STR (weapon damage is rolled
  // and dealt normally via attack(); the STR-scaled amount rides along as its
  // bonus, same convention as Rush/Spin). Base range 1 (melee); rank 4 grants
  // range 2, with a projectile flourish when the target isn't adjacent.
  function executeSmite(key, tx, ty) {
    pendingSkill = null;
    const cur = skillCur(key);
    if (!cur) return;
    const range = cur.range || 1;
    const target = monsterAt(tx, ty);
    if (!target || cheb(player.x, player.y, tx, ty) > range || !lineOfSight(player.x, player.y, tx, ty)) {
      log("Smite needs a clear target within range."); updateHotbar(); return;
    }
    const cost = 5;
    if (player.mp < cost) { log("Not enough MP for Smite (need " + cost + ")."); updateHotbar(); return; }
    player.mp -= cost;
    const bonus = Math.round(eff("STR") * (cur.strMult || 1));
    if (cheb(player.x, player.y, tx, ty) > 1) spawnProjectile(player.x, player.y, tx, ty, "#f0a838");
    log("You call down a Smite!", "hit");
    attack(player, target, bonus);
    player.skills[key].cd = 100;
    updateHotbar(); updateHUD();
    if (dead) return;
    worldTurn();
  }

  // Brynn's Throw: grab an adjacent monster and hurl it straight away from you
  // until it collides with a wall or another monster. Damage (rank 2+) rides
  // along attack() the same way Smite's STR bonus does — bonus = DEX, on top
  // of the normal weapon roll. Rank 3+ also damages whatever it collides with;
  // rank 4 refunds cooldown equal to the total damage dealt.
  function executeThrowSkill(key, tx, ty) {
    pendingSkill = null;
    const cur = skillCur(key);
    if (!cur) return;
    const target = monsterAt(tx, ty);
    if (!target || cheb(player.x, player.y, tx, ty) > 1) { log("Throw needs an adjacent target."); updateHotbar(); return; }
    let dx = Math.sign(tx - player.x), dy = Math.sign(ty - player.y);
    if (!dx && !dy) dx = 1;
    let x = target.x, y = target.y, hitOther = null, steps = 0;
    while (steps < 40) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny) || isWall(nx, ny) || (nx === player.x && ny === player.y)) break;
      const other = monsterAt(nx, ny);
      if (other && other !== target) { hitOther = other; break; }
      x = nx; y = ny; steps++;
    }
    target.x = x; target.y = y;
    floatText(x, y, "→", "#cfe6ff");
    log("You hurl the " + monName(target) + " backward!", "hit");
    let dealt = 0;
    if (cur.dealDmg) {
      const before = target.hp;
      attack(player, target, eff("DEX"));
      dealt += Math.max(0, before - target.hp);
      if (dead) return;
    }
    if (cur.chain && hitOther && hitOther.hp > 0) {
      const before2 = hitOther.hp;
      attack(player, hitOther, eff("DEX"));
      dealt += Math.max(0, before2 - hitOther.hp);
      if (dead) return;
    }
    player.skills[key].cd = cur.cdRefund ? Math.max(0, 100 - dealt) : 100;
    updateHotbar(); updateHUD(); computeFOV();
    worldTurn();
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
      if (it.boonKey) { const g = (DATA.boons || {})[it.boonKey] || {}; log("Boon of " + (g.name || it.boonKey) + " — " + (g.desc || "") + " Step onto it to claim it."); return; }
      if (it.key === "gold") { log(it.amount + " gold"); return; }
      const aff = isGear(it) ? itemAffixText(it) : "";
      log(itemName(it) + (aff ? " — " + aff : "")); return;
    }
    const torch = torches.find((tr) => tr.x === x && tr.y === y);
    if (torch) { log("A wall torch — tap it to take it; fire clears thorns."); return; }
    if (shopKeeper && shopKeeper.x === x && shopKeeper.y === y) { log("A merchant — tap to buy potions or sell your gear."); return; }
    if (fountain && fountain.x === x && fountain.y === y) { log("A fountain — tap to pay for a full heal."); return; }
    const t = map[y][x];
    log(t === WALL ? "A wall." : t === STAIRS ? "The way onward." :
        t === DOOR ? "A " + doorWord() + " — it opens as you pass and closes behind you, blocking sight." :
        t === THORN ? "A wall of thorns — you can force through, but it'll draw blood. Something waits beyond." :
        t === WATER ? "Deep water — too deep to wade. You'll have to go around; winged things won't." :
        t === CHASM ? "A chasm — step in and you'll fall straight through to the floor below." :
        t === RUBBLE ? "Loose rubble — broken stone underfoot." :
        t === GRASS ? "Tall grass — thick enough to hide in." :
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
      for (const el of body.querySelectorAll(".sknode-wrap")) {
        el.addEventListener("click", () => { charSelSkill = el.getAttribute("data-key"); renderChar(); });
      }
      for (const key of Object.keys(classSkills())) {
        const btn = document.getElementById("upg-" + key);
        if (btn) btn.addEventListener("click", () => learnSkill(key));
      }
    }
  }
  function charStatsHTML() {
    const cname = (DATA.classes[player.cls] || {}).name || "Adventurer";
    const df = defRange(armorDefMin(), armorDefMax());
    const effDesc = { STR: "+" + strBonus() + " dmg", VIT: computeMaxHp() + " HP", DEX: "acc " + playerAcc() + " / eva " + playerEva(), INT: computeMaxMp() + " MP", RES: "-" + Math.round(eff("RES")) + "% dmg taken", LCK: Math.round(critChance() * 100) + "% crit" };
    const cells = ["STR", "VIT", "DEX", "INT", "RES", "LCK"].map((k) => {
      const g = equipStat(k);
      const val = player.stats[k] + (g ? `<span style="color:#7ec98a;font-size:11px"> +${g}</span>` : "");
      return `<div class="cstat"><span>${k}<small>${effDesc[k]}</small></span><b>${val}</b></div>`;
    }).join("");
    const pts = player.statPoints > 0 ? `<span class="cpts">${player.statPoints} unspent points</span> — spend them under Skills.` : "No unspent points.";
    // Accuracy/Evasion, spelled out as chance-to-hit / chance-to-evade against a
    // baseline foe (monster defaults), plus the exact formula behind them.
    const accPct = Math.round(hitChance(playerAcc(), MON_EVA) * 100);
    const evaPct = Math.round((1 - hitChance(MON_ACC, playerEva())) * 100);
    const hastePct = Math.round(wornHaste() * 100);
    const hasteTxt = (hastePct >= 0 ? "+" : "") + hastePct + "%";
    return `<div class="cline"><b>${cname}</b> · Level ${player.level} · ${player.gold} gold</div>` +
      `<div class="cline">Attack <b>${playerAtk()}</b> · Defense <b>${df}</b> · HP <b>${player.hp}/${player.maxHp}</b> · MP <b>${player.mp}/${player.maxMp}</b></div>` +
      `<div class="cline">Crit <b>${Math.round(critChance() * 100)}%</b> for <b>${Math.round(critMult() * 100)}%</b> damage</div>` +
      `<div class="cline cformula">crit% = 5 + DEX + LCK + skills · crit dmg% = 200 + LCK×2 + skills</div>` +
      `<div class="cline">Accuracy <b>${playerAcc()}</b> (~${accPct}% to hit an average foe) · Evasion <b>${playerEva()}</b> (~${evaPct}% to evade an average hit)</div>` +
      `<div class="cline cformula">hit% = 50% + (attacker acc − defender eva) × 3%, clamped 10–95%</div>` +
      `<div class="cline">Haste <b>${hasteTxt}</b> · a step costs <b>${walkCost().toFixed(2)}</b> turns · a swing <b>${attackCost().toFixed(2)}</b></div>` +
      `<div class="cline cformula">step = 1 ÷ (1 + Haste + Metrognome-walk) · swing = 1 ÷ (weapon speed × (1 + Haste) + Metrognome-attack) · under 1.00 you act more often than your foes</div>` +
      `<div class="cline cformula">incoming dmg ×(1 − RES%), then armor block subtracted</div>` +
      `<div class="cstat-grid">${cells}</div>` +
      `<div class="cline">${pts}</div>`;
  }
  // Grid layout for the skill tree: nodes at their authored x/y (see
  // normalizeTree), one column per branch, spaced a node-diameter apart so
  // there's room for an arrow between rows. A skill with no x/y (a boon
  // active, granted outside the tree) gets stacked in reading order on a
  // row of its own below the real tree rather than overlapping node 0,0.
  function skillTreeLayout(sk) {
    const NODE = 88, COL = 176, ROW = 176;
    const keys = Object.keys(sk);
    const wired = [], loose = [];
    let maxTreeY = -1;
    for (const key of keys) {
      const d = sk[key];
      if (d.pos && typeof d.pos.x === "number" && typeof d.pos.y === "number") { wired.push(key); maxTreeY = Math.max(maxTreeY, d.pos.y); }
      else loose.push(key);
    }
    const looseRow = maxTreeY + 1;
    const pos = {};
    let maxX = 0, maxY = maxTreeY;
    for (const key of wired) { const d = sk[key]; pos[key] = { x: d.pos.x, y: d.pos.y }; maxX = Math.max(maxX, d.pos.x); }
    loose.forEach((key, i) => { pos[key] = { x: i, y: looseRow }; maxX = Math.max(maxX, i); maxY = Math.max(maxY, looseRow); });
    return {
      pos, NODE,
      cx: (key) => pos[key].x * COL + COL / 2,
      cy: (key) => pos[key].y * ROW + ROW / 2,
      width: (maxX + 1) * COL, height: (maxY + 1) * ROW + 30,
    };
  }
  function skillFmt(r) {
    const p = [];
    if (r.dmg != null) p.push((r.dmg >= 0 ? "+" : "") + r.dmg + " dmg");
    if (r.acc != null) p.push("+" + r.acc + " acc");
    if (r.eva != null) p.push("+" + r.eva + " eva");
    if (r.range) p.push("range " + r.range);
    if (r.stun) p.push(Math.round(r.stun * 100) + "% stun");
    if (r.freeAction) p.push("free action");
    if (r.cd != null) p.push(r.cd + "t cd");
    return p.join(", ") || "—";
  }
  // The lower detail card for whichever node is selected — same markup/CSS
  // (`.skillrow`) the old flat list used, just for one skill at a time.
  function charSkillDetailHTML(sk, key) {
    if (!key || !sk[key]) return `<div class="cline">Tap a node above to see what it does.</div>`;
    const d = sk[key], st = player.skills[key];
    const nextDef = st.rank < d.max ? d.ranks[st.rank] : null;
    const levelGate = (nextDef && nextDef.minLevel && player.level < nextDef.minLevel) ? nextDef.minLevel : 0;
    const prereqLocked = st.rank === 0 && !prereqsMet(d);
    const locked = prereqLocked || !!levelGate;
    const curTxt = st.rank > 0 ? (d.levels[st.rank - 1] || skillFmt(d.ranks[st.rank - 1])) : null;
    const nextTxt = st.rank < d.max ? (d.levels[st.rank] || skillFmt(d.ranks[st.rank])) : "Maxed.";
    const canUp = st.rank < d.max && player.statPoints > 0 && !locked;
    const label = locked ? "🔒 Locked" : st.rank === 0 ? "Learn (1 pt)" : st.rank < d.max ? "Upgrade (1 pt)" : "Maxed";
    const kindTag = d.kind === "passive" ? " · passive" : "";
    const reqParts = [];
    if (prereqLocked) reqParts.push(prereqNames(d).join(", ") || "a prerequisite");
    if (levelGate) reqParts.push("character level " + levelGate);
    const reqTxt = locked ? `<div class="sdesc" style="color:#e0a05a">Requires: ${reqParts.join(", ")}</div>` : "";
    return `<div class="skillrow"><div class="sh"><span class="sname"><span class="ic">${d.icon}</span>${d.name}</span>` +
      `<span class="srank">rank ${st.rank}/${d.max}${kindTag}</span></div>` +
      `<div class="sdesc">${d.desc}</div>` + reqTxt +
      `<div class="snext">${curTxt ? "Now: " + curTxt + "<br>" : ""}${st.rank < d.max ? "Next: " + nextTxt : nextTxt}</div>` +
      `<button class="upg" id="upg-${key}" ${canUp ? "" : "disabled"}>${label}</button></div>`;
  }
  function charSkillsHTML() {
    const sk = classSkills();
    const keys = Object.keys(sk);
    if (!keys.length) return `<div class="cline">This class has no skills yet.</div>`;
    if (charSelSkill && !sk[charSelSkill]) charSelSkill = null;
    const layout = skillTreeLayout(sk);
    const stateOf = (key) => {
      const d = sk[key], st = player.skills[key];
      if (st.rank >= 1) return "invested";
      return prereqsMet(d) ? "available" : "locked";
    };
    let nodesHtml = "";
    for (const key of keys) {
      const d = sk[key], st = player.skills[key];
      const x = layout.cx(key) - layout.NODE / 2, y = layout.cy(key) - layout.NODE / 2;
      const sel = key === charSelSkill;
      const icon = d.iconSprite ? `<img class="skicon-img" src="${d.iconSprite}" alt="">` : `<span class="skicon">${d.icon}</span>`;
      nodesHtml += `<div class="sknode-wrap" data-key="${key}" style="left:${x}px;top:${y}px;width:${layout.NODE}px">` +
        (sel ? `<div class="sksel" style="width:${layout.NODE + 16}px;height:${layout.NODE + 16}px;left:-8px;top:-8px"></div>` : "") +
        `<div class="sknode st-${stateOf(key)}">${icon}</div>` +
        `<div class="skbadge">${st.rank}/${d.max}</div></div>`;
    }
    // One arrow per prerequisite reference (req = AND, reqAny = OR — both
    // drawn the same way; the arrow itself only tells you whether *that*
    // source is invested, not whether it's enough to unlock the target).
    let arrowsHtml = "";
    for (const key of keys) {
      const d = sk[key];
      const refs = (d.req || []).concat(d.reqAny || []).map((r) => r[0]);
      for (const srcKey of refs) {
        if (!sk[srcKey] || !layout.pos[srcKey]) continue;
        const invested = player.skills[srcKey] && player.skills[srcKey].rank >= 1;
        const cls = invested ? "amber" : "grey";
        const x1 = layout.cx(srcKey), y1 = layout.cy(srcKey) + layout.NODE / 2;
        const x2 = layout.cx(key), y2 = layout.cy(key) - layout.NODE / 2;
        arrowsHtml += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="skarrow ${cls}" marker-end="url(#skarrow-${cls})"/>`;
      }
    }
    return `<div class="cline"><span class="cpts">${player.statPoints}</span> points to spend</div>` +
      `<div class="skilltree-wrap"><div class="skilltree" style="width:${layout.width}px;height:${layout.height}px">` +
      `<svg class="skilltree-svg" width="${layout.width}" height="${layout.height}"><defs>` +
      `<marker id="skarrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="skarrowhead amber"/></marker>` +
      `<marker id="skarrow-grey" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="skarrowhead grey"/></marker>` +
      `</defs>${arrowsHtml}</svg>${nodesHtml}</div></div>` +
      charSkillDetailHTML(sk, charSelSkill);
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
    if (dead) { if (e.key === "Enter" || e.key === " ") beginNewRun(); return; }
    if (boonPending || classPending) return;      // choose your boon/character first
    if (shopOpen) { if (e.key === "Escape") toggleShop(false); return; }
    if (fountainOpen) { if (e.key === "Escape") toggleFountain(false); return; }
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
  function waitTurn() { if (dead || mapOpen || invOpen || charOpen || boonPending || classPending || shopOpen || fountainOpen) return; walkPath = []; worldTurn(); }
  mapCanvas.addEventListener("click", () => toggleMap(false));

  // tap outside the pack card closes it
  const invOverlay = document.getElementById("inv");
  invOverlay.addEventListener("click", (e) => { if (e.target === invOverlay) toggleInv(false); });
  document.getElementById("invClose").addEventListener("click", () => toggleInv(false));

  // merchant floor: shop card + fountain confirm, tap-outside closes either
  { const el = document.getElementById("shop"); if (el) el.addEventListener("click", (e) => { if (e.target === el) toggleShop(false); }); }
  { const el = document.getElementById("shopClose"); if (el) el.addEventListener("click", () => toggleShop(false)); }
  { const el = document.getElementById("fountain"); if (el) el.addEventListener("click", (e) => { if (e.target === el) toggleFountain(false); }); }

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
    el.addEventListener("click", beginNewRun);
    el.addEventListener("touchstart", (e) => { e.preventDefault(); beginNewRun(); }, { passive: false });
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
    if (mapOpen || invOpen || charOpen || dead || boonPending || classPending) return;
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
    descend, regenerate: generateLevel, setZoom, toggleMap, toggleInv, toggleChar, restart, beginNewRun,
    toggleShop, toggleFountain, buyPotion: (i) => buyPotion(i), sellGear: (i) => sellGear(i), useFountain: () => useFountain(),
    pickClass: (key) => { if (classSelectCb) classSelectCb(key); },
    classRoster: () => Object.keys(DATA.classes || {}).filter((k) => DATA.classes[k].unlock === "start"),
    dname: (k) => displayName(k), dcolor: (k) => consumColor(k),
    stoneSkinTurns: () => (player.stoneSkin ? player.stoneSkin.turns : 0),
    hurt: (n) => { player.hp -= n; updateHUD(); if (player.hp <= 0) die(); },
    setGold: (n) => { player.gold = n; updateHUD(); },
    setStat: (k, v) => { if (player.stats[k] != null) player.stats[k] = v; updateHUD(); },
    give: (k) => { if (GEAR[k]) invAdd(rollItem(k, depth)); else if (defOf(k)) invAdd({ key: k }); },
    // deterministic gear for tests: giveGear("sword", {rarity, plus, stats:[{stat,val}], enchants:[...]})
    giveGear: (k, o) => { if (GEAR[k]) player.inv.push(Object.assign(mkBase(k), o || {})); },
    rollItem: (k, f) => rollItem(k, f != null ? f : depth),
    rollGear: (f) => rollGearDrop(f != null ? f : depth),
    rollTrinket: (f) => rollTrinket(f != null ? f : depth),
    costs: () => ({ walk: walkCost(), attack: attackCost() }),
    turnMeter: () => ({ turnMeter, lastActionCost }),
    offerBoons, pickBoon,
    giveBoon: (k) => pickBoon(k),
    addTrap: (key, x, y) => { traps.push({ x, y, key, revealed: true, sprung: false }); },
    springTrap: (i) => { if (traps[i]) triggerTrap(traps[i]); },
    throwAt: (idx, x, y) => executeThrow(idx, x, y),
    throwSkillAt: (key, x, y) => executeThrowSkill(key, x, y),
    setClass: (key) => { applyClass(key); renderChar(); updateHotbar(); updateHUD(); },
    anims: () => ({ projectiles: projectiles.length, streaks: streaks.length, spirals: spirals.length, bursts: bursts.length }),
    // Where each monster is actually being DRAWN (rx/ry) versus where it logically
    // is (x/y), plus any queued movement legs — so animation can be tested, not
    // just eyeballed.
    renderPos: () => monsters.filter((m) => m.hp > 0).map((m) => ({
      type: m.type, x: m.x, y: m.y, rx: m.rx, ry: m.ry, wp: (m.wp || []).slice(),
    })),
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
        killCount: player.killCount || 0, boonAcc: player.boonAcc || 0, boonEva: player.boonEva || 0,
        boonHaste: player.boonHaste || 0, hasteBuff: player.hasteBuff || 0, critChance: critChance(),
        skillsAll: Object.keys(player.skills || {}),
        cls: player.cls, stats: Object.assign({}, player.stats), statPoints: player.statPoints,
        boons: player.boons ? [...player.boons] : [], boonPending, classPending,
        atk: playerAtk(), atkBonus: player.atkBonus, gold: player.gold, weapon: player.weapon, armor: player.armor,
        ring1: player.ring1, ring2: player.ring2, trinket: player.trinket, necklace: player.necklace,
        effStats: { STR: eff("STR"), INT: eff("INT"), VIT: eff("VIT"), DEX: eff("DEX"), RES: eff("RES"), LCK: eff("LCK") },
        weaponDmg: [weaponDmgMin(), weaponDmgMax()], weaponAccuracy: weaponAccuracy(), weaponSpeed: weaponSpeed(), armorDef: [armorDefMin(), armorDefMax()],
        inv: player.inv.map((i) => i.key), invItems: player.inv.map((i) => Object.assign({}, i)), identified: [...identified],
        x: player.x, y: player.y, dead, explored: ex, stun: player.stun || 0,
        camX, camY, panX, panY,
        biome: biome ? biome.name : null, floor: floorInBiome(depth), bossActive,
        inShop, shopKeeper: shopKeeper ? { x: shopKeeper.x, y: shopKeeper.y } : null,
        fountain: fountain ? { x: fountain.x, y: fountain.y } : null,
        shopStock: shopStock.slice(), shopHealCost, shopOpen, fountainOpen,
        grid: { w: MAP_W, h: MAP_H }, fill: genStats,
        hasStairs: map.some((row) => row.includes(STAIRS)),
        monsters: monsters.length,
        mlist: monsters.map((m) => ({ x: m.x, y: m.y, type: m.type, hp: m.hp, maxHp: m.maxHp, level: m.level, ranged: !!m.ranged, charge: !!m.charge, acc: m.acc != null ? m.acc : MON_ACC, eva: m.eva != null ? m.eva : MON_EVA, aware: !!m.aware, dots: m.dots ? m.dots.map((d) => Object.assign({}, d)) : [], stun: m.stun || 0, summoned: !!m.summoned, phased: !!m.phased, beam: m.beam ? { tiles: m.beam.tiles.map((t) => t.slice()) } : null, windup: m.windup ? { kind: m.windup.kind, turns: m.windup.turns } : null, slamCd: m.slamCd || 0, fleeing: m.fleeing || 0, berserk: m.berserk || 0, lastSeen: m.lastSeen ? { x: m.lastSeen.x, y: m.lastSeen.y } : null, searchTurns: m.searchTurns == null ? null : m.searchTurns })),
        items: items.map((it) => ({ x: it.x, y: it.y, key: it.key, rarity: it.rarity || null, plus: it.plus || 0, stats: it.stats || null, enchants: it.enchants || null, variant: it.variant || null, vault: !!it.vault, boonKey: it.boonKey || null, boonGroup: it.boonGroup || null })),
        torches: torches.map((t) => ({ x: t.x, y: t.y })),
        traps: traps.map((t) => ({ x: t.x, y: t.y, key: t.key, revealed: !!t.revealed, sprung: !!t.sprung, armed: t.armed || 0 })),
        thorns: (() => { let n = 0; for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (map[y][x] === THORN) n++; return n; })(),
      };
    },
    tileAt: (x, y) => (inBounds(x, y) ? map[y][x] : -1),
    passableAt: (x, y) => passable(x, y),                          // on foot — deep water says no
    passableFlying: (x, y) => passableFor({ flying: true }, x, y),
    tileConstants: () => ({ WALL, FLOOR, STAIRS, DOOR, THORN, WATER, CHASM, RUBBLE, GRASS }),
    tileDeclared: (t) => Object.prototype.hasOwnProperty.call(TILE, t),
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
    equip: (i) => equipItem(i),
    upgradePending: () => pendingUpgrade,
    confirmUpgradeOn: (slotKey) => { const it = player[slotKey]; if (pendingUpgrade && it && GEAR[it.key].cat !== "trinket") confirmUpgrade(it); },
    cancelUpgrade: () => { pendingUpgrade = false; },
    pathStep: (sx, sy, tx, ty) => monsterPathStep(sx, sy, tx, ty),
    forceAware: (i, tx, ty) => { const m = monsters[i]; if (m) { m.aware = true; m.lastSeen = { x: tx, y: ty }; m.searching = false; m.searchTurns = null; m.searchSpot = null; } },
    golemShield: () => { const g = monsters.find((m) => m.type === "golem"); return g ? _boss.golemShield(g) : 0; },
    forceSlam: (i) => { const m = monsters[i]; if (m) { m.slamCd = 0; m.aware = true; } },
    nodeBlasts: () => _boss.nodeBlasts(),
    setMonsterHp: (i, hp) => { const m = monsters[i]; if (m) m.hp = Math.min(hp, m.maxHp); },
    placeMonster: (i, x, y) => { const m = monsters[i]; if (m) { m.x = x; m.y = y; } },
    bossRoomRect: () => (bossRoom ? { x: bossRoom.x, y: bossRoom.y, w: bossRoom.w, h: bossRoom.h } : null),
    nearestWall: (x, y) => nearestRoomWallSpot(bossRoom, x, y),
    stairsAt: () => findStairs(),
    // Can the player physically walk to (tx, ty)? Terrain-only flood fill, the same
    // one the generator uses to guarantee connectivity — so tests/smoke.js can prove
    // a floor is completable without depending on monster positions or explored state.
    reach: (tx, ty, blockThorns) => inBounds(tx, ty) && floodReach(player.x, player.y, !!blockThorns).has(ty * MAP_W + tx),
    step: (dx, dy) => playerAct(dx, dy),
    place: (x, y) => { if (passable(x, y)) { player.x = x; player.y = y; computeFOV(); snapPlayer(); } },
    tap: (x, y) => walkTo(x, y),
    walking: () => walkPath.length,
    tick: (cost) => { if (!dead) worldTurn(cost); },   // pass a cost to exercise difficult terrain
    // Take one world turn and report the exact tiles each monster walked. A
    // movement bug shows up here as a chain with a gap in it — two tiles that
    // aren't neighbours — which is precisely what the renderer would then have
    // to draw as a glide straight through the wall, bush or player in between.
    // Charges and teleports deliberately record no legs (they set their own
    // animation), so the caller skips those.
    tickPaths: (cost) => {
      if (dead) return [];
      const before = monsters.filter((m) => m.hp > 0).map((m) => ({ m, x: m.x, y: m.y }));
      worldTurn(cost);
      return before.filter((b) => b.m.hp > 0).map((b) => ({
        type: b.m.type, boss: !!b.m.boss, charge: !!b.m.charge, acts: b.m.acts | 0,
        from: [b.x, b.y], to: [b.m.x, b.m.y],
        legs: (b.m.wp || []).map((t) => t.slice()),
      }));
    },
    turns: () => turns,
    // ---- Boon-system test hooks ----
    setKillCount: (n) => { player.killCount = n; },
    setMp: (n) => { player.mp = Math.min(player.maxMp, n); updateHUD(); },
    setHasteBuff: (n) => { player.hasteBuff = n; },
    setFleeing: (i, n) => { const m = monsters[i]; if (m) m.fleeing = n; },
    setBerserk: (i, n) => { const m = monsters[i]; if (m) m.berserk = n; },
    boonSkillCd: (k) => (player.skills[k] ? player.skills[k].cd : null),
    wallState: () => activeWalls.map((w) => Object.assign({}, w)),
    pullState: () => (pullZone ? Object.assign({}, pullZone) : null),
    secondChanceUsed: () => player.secondChanceUsed,
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
  beginNewRun();       // pick a hero, then the run's first boon — including this very first run
  requestAnimationFrame(frame);
})();
