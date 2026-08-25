/* ============================================================================
   Cantori — CONTENT DATA
   ----------------------------------------------------------------------------
   This is the "easy interface": everything you tune or add lives here, apart
   from the engine (game.js). To change the game's content you only edit this
   file — numbers, names, new entries — and reload.

   HOW TO EDIT (the basics):
     • Each entry is  key: { field: value, ... }
     • Numbers change balance (hp, atk, def, weight…). Bigger `weight` = drops
       more often.
     • Text in "quotes" is a name shown to the player.
     • Keep the commas and braces { } as they are; add a new entry by copying a
       line and changing the values.
     • A monster/item's picture comes from assets/tiles/<key>.png — so the key
       (e.g. "rat") must match a sprite file, or add a new sprite with that name.

   Sections marked  [DESIGN — not wired in yet]  are the plans for classes,
   stats and gods. They're written down here so they're easy to shape now; the
   engine will start reading them as we build those systems.
   ========================================================================== */

window.CANTORI_DATA = {

  /* ==========================================================================
     MONSTERS   (fields: hp, atkMin/atkMax = damage range,
     glyph/color = fallback if the sprite is missing)
       minFloor = ON/OFF switch *and* the earliest floor within its biome (1..5)
                  it may appear. EMPTY minFloor = the monster is OFF (never spawns);
                  a number turns it on. (A monster also has to be listed in a
                  biome's `monsters` to appear there — see the Biomes section.)
       acc / eva = accuracy & evasion (hit chance = acc / (acc + defender eva);
                   omitted -> default acc 12, eva 4). Surprise attacks always hit.
       charge  = rushes in a straight line (line of sight), +1 damage per tile
       ranged  = attacks from afar up to `range` tiles (line of sight)
     ========================================================================== */
  monsters: {
    // Cave / early vermin
    rat:    { name: "Rat",    hp: 3, atkMin: 1, atkMax: 2, minFloor: 1, glyph: "r", color: "#c9b48f" },
    bat:    { name: "Bat",    hp: 2, atkMin: 1, atkMax: 2, minFloor: 1, glyph: "b", color: "#b491d6" },
    snake:  { name: "Snake",  hp: 4, atkMin: 2, atkMax: 3, minFloor: 1, glyph: "s", color: "#7ec98a" },
    spider: { name: "Spider", hp: 3, atkMin: 1, atkMax: 3, minFloor: 1, glyph: "x", color: "#d68f8f" },
    // Forest
    wolf:   { name: "Wolf",   hp: 7,  atkMin: 2, atkMax: 4, acc: 11, eva: 3,  minFloor: 1, glyph: "W", color: "#9aa0a8" },
    bee:    { name: "Bee",    hp: 2,  atkMin: 2, atkMax: 3, acc: 10, eva: 16, minFloor: 1, glyph: "e", color: "#e6c34a" },
    bear:   { name: "Bear",   hp: 12, atkMin: 3, atkMax: 5, acc: 14, eva: 1,  charge: true, minFloor: 3, glyph: "B", color: "#8a6a44" },
    harpy:  { name: "Harpy",  hp: 5,  atkMin: 2, atkMax: 4, acc: 13, eva: 8,  ranged: true, range: 4, minFloor: 4, glyph: "H", color: "#6b6f7a" },
    // Disabled (no minFloor) — spare monsters kept for reuse; add a minFloor to turn on.
    jackal: { name: "Jackal", hp: 3, atkMin: 1, atkMax: 2, glyph: "j", color: "#b79a6b" },
    hornet: { name: "Hornet", hp: 2, atkMin: 2, atkMax: 3, glyph: "h", color: "#e0a13c" },
    // Tomb
    ghoul:   { name: "Ghoul",   hp: 7, atkMin: 3, atkMax: 5, minFloor: 1, glyph: "G", color: "#9fb07a" },
    wraith:  { name: "Wraith",  hp: 6, atkMin: 3, atkMax: 4, minFloor: 1, glyph: "W", color: "#8fa0c0" },
    phantom: { name: "Phantom", hp: 5, atkMin: 2, atkMax: 4, minFloor: 1, glyph: "P", color: "#7ee0d0" },
    // Arcane / Beyond
    imp:          { name: "Imp",          hp: 5,  atkMin: 3, atkMax: 5, minFloor: 1, glyph: "i", color: "#c0c0e0" },
    ufetubus:     { name: "Ufetubus",     hp: 4,  atkMin: 2, atkMax: 4, minFloor: 1, glyph: "u", color: "#6fb0d0" },
    orange_demon: { name: "Orange Demon", hp: 10, atkMin: 4, atkMax: 7, minFloor: 1, glyph: "d", color: "#e07030" },
  },

  /* ==========================================================================
     GEAR — weapons, armor & jewelry
       cat:     "weapon" | "armor" | "ring" | "trinket" | "necklace"
       tier:    quality tier (1–3). Two jobs: (1) a rolled affix's magnitude = tier
                (tier 1 = +1 stat … tier 3 = +3); (2) it groups the item for drops.
       WEAPONS also carry: dmgMin/dmgMax (damage range), speed (attacks per turn —
                >1 is fast, <1 is slow), accuracy (added to your hit chance).
       ARMOR carries: def (damage reduction).
       rarity:  drop chance of THIS type within its (tier + category) group, as a %.
                Items with NO rarity are the DEFAULT(s): they split whatever % is
                left. e.g. tier-1 weapons dagger(none), dirk(30), hammer(10) →
                dirk 30%, hammer 10%, dagger 60%. Raise hammer to 20 → dagger 50%.
       req:     stat needed to equip — Diablo-style gating. req.STR also scales
                weapon damage: STR bonus = floor((STR - req.STR) / 4).
     ========================================================================== */
  gear: {
    dagger:  { cat: "weapon", name: "Dagger", dmgMin: 1, dmgMax: 3,  speed: 1.5, accuracy: 2,  tier: 1, req: { STR: 0 }, glyph: "/", color: "#cfc3a0" },
    sword:   { cat: "weapon", name: "Sword",  dmgMin: 3, dmgMax: 6,  speed: 1,   accuracy: 0,  tier: 2, req: { STR: 4 }, glyph: "/", color: "#d8e0ec" },
    mace:    { cat: "weapon", name: "Mace",   dmgMin: 5, dmgMax: 10, speed: 0.7, accuracy: -1, tier: 3, req: { STR: 8 }, glyph: "/", color: "#c8a878" },
    leather: { cat: "armor",  name: "Leather Armor", def: 1, tier: 1, req: { STR: 0 }, glyph: "[", color: "#b98a5a" },
    chain:   { cat: "armor",  name: "Chain Mail",    def: 2, tier: 2, req: { STR: 4 }, glyph: "[", color: "#b9c0c8" },
    plate:   { cat: "armor",  name: "Plate Armor",   def: 3, tier: 3, req: { STR: 8 }, glyph: "[", color: "#dfe6f0" },
    // Jewelry — ring (x2) / trinket / necklace slots. No base damage/def; their
    // value is rolled affixes (green+), so a plain white one is trash.
    ring_copper: { cat: "ring",     name: "Copper Ring", tier: 1, glyph: "o", color: "#c58a4a" },
    ring_silver: { cat: "ring",     name: "Silver Ring", tier: 2, glyph: "o", color: "#cfd4dc" },
    charm_bone:  { cat: "trinket",  name: "Bone Charm",  tier: 1, glyph: "*", color: "#d8cfb0" },
    amulet_jade: { cat: "necklace", name: "Jade Amulet", tier: 2, glyph: "\"", color: "#7ec9a0" },
  },

  /* ==========================================================================
     LOOT SYSTEM — rarity, affixes, enchants (consumed by game.js)
       rarities:  chance table + the display color for each tier. Gold is not in
                  the random table — golds are hand-authored uniques.
       stat pool: which stats a random affix can roll (magnitude = item tier).
       enchants:  on-hit procs. Weapons fire them on your strike; enchanted armor
                  fires them back at whoever hits you (its "power" is armor def).
         fire:     a burst = ceil(power/2), then a burn for ceil(burst/2) per turn
                   over 3 turns.
         electric: a burst = power, with a stun chance = (burst * 10%) / target level.
       plus:      +X applies on top of any rarity; it raises base atk/def AND every
                  rolled affix by X. Max +X on a floor = ceil(floor / 5).
     ========================================================================== */
  loot: {
    rarities: [
      { key: "white",  name: "",        chance: 0.50, color: "#e6e0d2" },
      { key: "green",  name: "",        chance: 0.30, color: "#7ec98a" },
      { key: "blue",   name: "",        chance: 0.15, color: "#5a9fe0" },
      { key: "purple", name: "",        chance: 0.05, color: "#b491d6" },
      { key: "gold",   name: "",        chance: 0.00, color: "#f0c14b" },
    ],
    statPool: ["STR", "INT", "VIT", "DEX", "RES", "LCK"],
    purpleSecondStatChance: 0.75,       // purple's extra roll: 75% stat, else enchant
    enchants: {
      fire:     { name: "Flaming",   icon: "🔥", color: "#ff8f4a" },
      electric: { name: "Charged",   icon: "⚡", color: "#9ad0ff" },
    },
    // When a gear item drops: first pick a CATEGORY (these relative weights), then
    // a TIER by floor (tierBands below), then a TYPE within that tier+category
    // using each item's `rarity` (defaults split the remainder).
    categoryWeights: { weapon: 40, armor: 30, ring: 12, trinket: 9, necklace: 9 },
    // Tier chance by depth. The first band whose `upToFloor` >= the current floor
    // wins; `weights` are for tiers [1, 2, 3]. (25 floors = 5 biomes of 5.)
    tierBands: [
      { upToFloor: 5,  weights: [100, 0, 0] },    // Forest — all tier 1
      { upToFloor: 10, weights: [70, 30, 0] },    // Cave
      { upToFloor: 15, weights: [30, 55, 15] },   // Tomb
      { upToFloor: 20, weights: [10, 45, 45] },   // Arcane Tomb
      { upToFloor: 25, weights: [0, 25, 75] },    // The Beyond — mostly tier 3
    ],
  },

  /* ==========================================================================
     CONSUMABLES — potions, scrolls & tools (unidentified until used)
       cat:    "potion", "scroll", or "tool" (tools show their name, never drop)
       effect: what it does (engine handles: heal, strength, poison, map,
               teleport, burn)
       weight: how often it drops (relative). weight 0 = never in the drop pool
               (torches are taken off the wall, not found as loot)
     ========================================================================== */
  consumables: {
    heal:     { cat: "potion", name: "Potion of Healing",  effect: "heal",     weight: 5, glyph: "!", color: "#e0685a" },
    strength: { cat: "potion", name: "Potion of Strength", effect: "strength", weight: 2, glyph: "!", color: "#f0a838" },
    poison:   { cat: "potion", name: "Potion of Poison",   effect: "poison",   weight: 2, glyph: "!", color: "#7ec98a" },
    mapping:  { cat: "scroll", name: "Scroll of Magic Mapping", effect: "map",      weight: 3, glyph: "?", color: "#cfe6b0" },
    teleport: { cat: "scroll", name: "Scroll of Teleport",      effect: "teleport", weight: 2, glyph: "?", color: "#b491d6" },
    torch:    { cat: "tool",   name: "Torch", effect: "burn", weight: 0, glyph: "|", color: "#f6b845" },
  },

  /* ==========================================================================
     BOSSES — one waits on the 5th floor of each biome. Beat it to descend.
     (Special behaviours come later; for now they're big, hard fights.)
     ========================================================================== */
  bosses: {
    piper:   { name: "The Pied Piper", hp: 30,  atkMin: 3, atkMax: 5 },
    golem:   { name: "Stone Golem",    hp: 55,  atkMin: 5, atkMax: 8 },
    cultist: { name: "Cultist",        hp: 20,  atkMin: 4, atkMax: 6 },
    mummy:   { name: "The Mummy",      hp: 90,  atkMin: 7, atkMax: 10 },
    demigod: { name: "The Demi-God",   hp: 150, atkMin: 9, atkMax: 13 },
  },

  /* ==========================================================================
     BIOMES — the dungeon is 5 biomes of 5 floors each (25 floors, then a win).
       floor/wall: which tile sprites the biome uses
       monsters:   which creatures spawn here (keys from `monsters`)
       boss:       which boss (key from `bosses`) guards the 5th floor
       bossCount:  how many of that boss appear (default 1)
       final:      true on the last biome — beating its boss WINS the game
       spawnInitial: how many monsters a fresh floor starts with
       spawnEvery:   a new monster wanders in every N turns (0 = none)
       spawnCap:     never exceed this many monsters at once
       exitStyle:    "wall" carves the exit as a gap in the border (a path);
                     otherwise it's stairs in a room
       exitSprite:   sprite drawn on the exit tile (default "stairs")
       door:         how hall entrances are drawn — "bush" for the forest,
                     "door" (wooden/stone panel) elsewhere
     ========================================================================== */
  biomes: [
    { key: "forest", name: "Forest",      floor: "forest_floor", wall: "forest_wall",
      monsters: ["rat", "wolf", "bee", "bear", "harpy"], boss: "piper",
      spawnInitial: [3, 5, 5, 5], spawnEvery: 14, spawnCap: 16,   // per floor 1..4 (floor 5 is the boss)
      exitStyle: "wall", exitSprite: "exit_forest", door: "bush" },
    { key: "cave",   name: "Cave",        floor: "floor",        wall: "wall",
      monsters: ["rat", "bat", "snake", "spider"],       boss: "golem", door: "door" },
    { key: "tomb",   name: "Tomb",        floor: "tomb_floor",   wall: "tomb_wall",
      monsters: ["ghoul", "wraith", "phantom"],          boss: "cultist", bossCount: 3, door: "door" },
    { key: "arcane", name: "Arcane Tomb", floor: "arcane_floor", wall: "arcane_wall",
      monsters: ["wraith", "phantom", "imp"],            boss: "mummy", door: "door" },
    { key: "space",  name: "The Beyond",  floor: "space_floor",  wall: "space_wall",
      monsters: ["ufetubus", "imp", "orange_demon"],     boss: "demigod", final: true, door: "door" },
  ],

  /* ==========================================================================
     STATS   [DESIGN — not wired in yet]
     The six core stats. `main` is the primary payoff; `aux` the secondary.
     ========================================================================== */
  stats: {
    STR: { name: "Strength",     main: "Damage",              aux: "Weapon access (equip requirements)" },
    INT: { name: "Intelligence", main: "Wand & spell power",  aux: "Identifying items" },
    VIT: { name: "Vitality",     main: "Health",              aux: "Damage resistance" },
    DEX: { name: "Dexterity",    main: "Accuracy",            aux: "Evasion" },
    RES: { name: "Resonance",    main: "Enchantment procs",   aux: "Magic resistance" },
    LCK: { name: "Luck",         main: "Critical hits",       aux: "A little of everything" },
  },

  /* ==========================================================================
     CLASSES   [DESIGN — not wired in yet]
     Each class has a main + secondary stat and a starting kit. These are
     starting proposals — rename, rebalance, or add freely.
       start.weapon / start.armor: a gear key from `gear` above (or null)
       unlock: "start" = available from the beginning; otherwise unlocked in town
       baseMp: starting max MP (mana pool; spells later spend it)
       levelUp: flat bonuses gained on EVERY level (on top of the +2 main / +1
                secondary / +1 free point) — hp, mp, accuracy, evasion
     ========================================================================== */
  classes: {
    warrior: { name: "Warrior", main: "STR", secondary: "VIT", unlock: "start",
               stats: { STR: 8, VIT: 7, DEX: 4, INT: 3, RES: 3, LCK: 4 },
               start: { weapon: "sword", armor: "leather" },
               baseMp: 5,
               levelUp: { hp: 5, mp: 2, accuracy: 2, evasion: 2 },
               blurb: "Front-line brawler. Hits hard, endures more.",
               // Skills cost 1 banked point per rank. `ranks` are the values AT that
               // rank (dmg = bonus damage over a normal hit; cd = cooldown in turns).
               skills: {
                 rush: {
                   name: "Rush", icon: "➤",
                   desc: "Dash in a direction until you collide — smash a monster, or ram yourself into a wall.",
                   max: 3,
                   ranks: [ { cd: 100, dmg: 0 }, { cd: 100, dmg: 3 }, { cd: 50, dmg: 5 } ],
                 },
                 spin: {
                   name: "Spin", icon: "↻",
                   desc: "Whirl and strike every monster around you.",
                   max: 3,
                   ranks: [ { cd: 80, dmg: 0, range: 1 }, { cd: 80, dmg: 1, range: 1 }, { cd: 80, dmg: 1, range: 2 } ],
                 },
               } },
    duelist: { name: "Duelist", main: "DEX", secondary: "LCK", unlock: "start",
               start: { weapon: "dagger", armor: "leather" },
               blurb: "Fast and precise — evasion and critical strikes." },
    adept:   { name: "Adept",   main: "INT", secondary: "RES", unlock: "town",
               start: { weapon: "dagger", armor: null },
               blurb: "Wands and enchantments over steel. (needs spells system)" },
    warden:  { name: "Warden",  main: "VIT", secondary: "STR", unlock: "town",
               start: { weapon: "mace", armor: "chain" },
               blurb: "Immovable. Trades speed for raw durability." },
  },

  /* ==========================================================================
     GODS / BOONS   [DESIGN — not wired in yet]
     Hades-style: at the start of each biome you pick 1 of 3 boons drawn from
     the unlocked gods. Boon lists will be filled in as we build the system.
       unlock: "start" available now; "sealed" needs a condition (e.g. a win)
     ========================================================================== */
  gods: {
    kethara: { name: "Kethara", domain: "Order & Domination",        unlock: "start",  boons: [] },
    maelon:  { name: "Maelon",  domain: "Death & Decomposition",     unlock: "town",   boons: [] },
    ourn:    { name: "Ourn",    domain: "Time",                      unlock: "town",   boons: [] },
    label:   { name: "The Label", domain: "Conjuration & Tempo",     unlock: "town",   boons: [] },
    guild:   { name: "The Guild", domain: "Itemization & Customization", unlock: "town", boons: [] },
    auvris:  { name: "Auvris",  domain: "Nature & Inspiration",      unlock: "sealed", boons: [],
               note: "Sealed — unlocks after beating the game once." },
  },

};
