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
     MONSTERS   (fields: hp, atkMin/atkMax = damage range, erratic 0..1 = how
     randomly it moves, glyph/color = fallback if the sprite is missing)
     ========================================================================== */
  monsters: {
    // Cave / early vermin
    rat:    { name: "Rat",    hp: 3, atkMin: 1, atkMax: 2, erratic: 0.0,  glyph: "r", color: "#c9b48f" },
    bat:    { name: "Bat",    hp: 2, atkMin: 1, atkMax: 2, erratic: 0.55, glyph: "b", color: "#b491d6" },
    snake:  { name: "Snake",  hp: 4, atkMin: 2, atkMax: 3, erratic: 0.0,  glyph: "s", color: "#7ec98a" },
    spider: { name: "Spider", hp: 3, atkMin: 1, atkMax: 3, erratic: 0.2,  glyph: "x", color: "#d68f8f" },
    // Forest
    //   evasion 0..1 = chance to dodge an attack
    //   charge  = rushes in a straight line (line of sight), +1 damage per tile crossed
    //   ranged  = attacks from afar up to `range` tiles (line of sight)
    //   minFloor = earliest floor *within the biome* (1..5) it may appear
    wolf:   { name: "Wolf",   hp: 7,  atkMin: 2, atkMax: 4, erratic: 0.05, glyph: "W", color: "#9aa0a8" },
    bee:    { name: "Bee",    hp: 2,  atkMin: 2, atkMax: 3, erratic: 0.4,  evasion: 0.45, glyph: "e", color: "#e6c34a" },
    bear:   { name: "Bear",   hp: 12, atkMin: 3, atkMax: 5, erratic: 0.0,  charge: true, minFloor: 3, glyph: "B", color: "#8a6a44" },
    harpy:  { name: "Harpy",  hp: 5,  atkMin: 2, atkMax: 4, erratic: 0.1,  ranged: true, range: 4, minFloor: 4, glyph: "H", color: "#6b6f7a" },
    jackal: { name: "Jackal", hp: 3, atkMin: 1, atkMax: 2, erratic: 0.1,  glyph: "j", color: "#b79a6b" },
    hornet: { name: "Hornet", hp: 2, atkMin: 2, atkMax: 3, erratic: 0.35, glyph: "h", color: "#e0a13c" },
    // Tomb
    ghoul:   { name: "Ghoul",   hp: 7, atkMin: 3, atkMax: 5, erratic: 0.0,  glyph: "G", color: "#9fb07a" },
    wraith:  { name: "Wraith",  hp: 6, atkMin: 3, atkMax: 4, erratic: 0.2,  glyph: "W", color: "#8fa0c0" },
    phantom: { name: "Phantom", hp: 5, atkMin: 2, atkMax: 4, erratic: 0.45, glyph: "P", color: "#7ee0d0" },
    // Arcane / Beyond
    imp:          { name: "Imp",          hp: 5,  atkMin: 3, atkMax: 5, erratic: 0.4, glyph: "i", color: "#c0c0e0" },
    ufetubus:     { name: "Ufetubus",     hp: 4,  atkMin: 2, atkMax: 4, erratic: 0.5, glyph: "u", color: "#6fb0d0" },
    orange_demon: { name: "Orange Demon", hp: 10, atkMin: 4, atkMax: 7, erratic: 0.2, glyph: "d", color: "#e07030" },
  },

  /* ==========================================================================
     GEAR — weapons & armor
       cat:    "weapon" or "armor"
       atk:    weapon damage bonus     |   def: armor damage reduction
       weight: how often it drops (relative)
       req:    stat needed to equip — Diablo-style gating. [DESIGN — not yet
               enforced; here so it's easy to plan the numbers.]
     ========================================================================== */
  gear: {
    dagger:  { cat: "weapon", name: "Dagger", atk: 1, weight: 5, req: { DEX: 0 },  glyph: "/", color: "#cfc3a0" },
    sword:   { cat: "weapon", name: "Sword",  atk: 3, weight: 2, req: { STR: 12 }, glyph: "/", color: "#d8e0ec" },
    mace:    { cat: "weapon", name: "Mace",   atk: 5, weight: 1, req: { STR: 18 }, glyph: "/", color: "#c8a878" },
    leather: { cat: "armor",  name: "Leather Armor", def: 1, weight: 4, req: { STR: 0 },  glyph: "[", color: "#b98a5a" },
    chain:   { cat: "armor",  name: "Chain Mail",    def: 2, weight: 2, req: { STR: 14 }, glyph: "[", color: "#b9c0c8" },
    plate:   { cat: "armor",  name: "Plate Armor",   def: 3, weight: 1, req: { STR: 20 }, glyph: "[", color: "#dfe6f0" },
  },

  /* ==========================================================================
     CONSUMABLES — potions & scrolls (unidentified until used)
       cat:    "potion" or "scroll"
       effect: what it does (engine handles: heal, strength, poison, map, teleport)
       weight: how often it drops (relative)
     ========================================================================== */
  consumables: {
    heal:     { cat: "potion", name: "Potion of Healing",  effect: "heal",     weight: 5, glyph: "!", color: "#e0685a" },
    strength: { cat: "potion", name: "Potion of Strength", effect: "strength", weight: 2, glyph: "!", color: "#f0a838" },
    poison:   { cat: "potion", name: "Potion of Poison",   effect: "poison",   weight: 2, glyph: "!", color: "#7ec98a" },
    mapping:  { cat: "scroll", name: "Scroll of Magic Mapping", effect: "map",      weight: 3, glyph: "?", color: "#cfe6b0" },
    teleport: { cat: "scroll", name: "Scroll of Teleport",      effect: "teleport", weight: 2, glyph: "?", color: "#b491d6" },
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
     ========================================================================== */
  biomes: [
    { key: "forest", name: "Forest",      floor: "forest_floor", wall: "forest_wall",
      monsters: ["rat", "wolf", "bee", "bear", "harpy"], boss: "piper",
      spawnInitial: [3, 5, 5, 5], spawnEvery: 14, spawnCap: 16,   // per floor 1..4 (floor 5 is the boss)
      exitStyle: "wall", exitSprite: "exit_forest" },
    { key: "cave",   name: "Cave",        floor: "floor",        wall: "wall",
      monsters: ["rat", "bat", "snake", "spider"],       boss: "golem" },
    { key: "tomb",   name: "Tomb",        floor: "tomb_floor",   wall: "tomb_wall",
      monsters: ["ghoul", "wraith", "phantom"],          boss: "cultist", bossCount: 3 },
    { key: "arcane", name: "Arcane Tomb", floor: "arcane_floor", wall: "arcane_wall",
      monsters: ["wraith", "phantom", "imp"],            boss: "mummy" },
    { key: "space",  name: "The Beyond",  floor: "space_floor",  wall: "space_wall",
      monsters: ["ufetubus", "imp", "orange_demon"],     boss: "demigod", final: true },
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
     ========================================================================== */
  classes: {
    warrior: { name: "Warrior", main: "STR", secondary: "VIT", unlock: "start",
               stats: { STR: 8, VIT: 7, DEX: 4, INT: 3, RES: 3, LCK: 4 },
               start: { weapon: "sword", armor: "leather" },
               blurb: "Front-line brawler. Hits hard, endures more." },
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
