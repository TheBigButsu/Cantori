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
    rat:    { name: "Rat",    hp: 3, atkMin: 1, atkMax: 2, erratic: 0.0,  glyph: "r", color: "#c9b48f" },
    bat:    { name: "Bat",    hp: 2, atkMin: 1, atkMax: 2, erratic: 0.55, glyph: "b", color: "#b491d6" },
    snake:  { name: "Snake",  hp: 4, atkMin: 2, atkMax: 3, erratic: 0.0,  glyph: "s", color: "#7ec98a" },
    spider: { name: "Spider", hp: 3, atkMin: 1, atkMax: 3, erratic: 0.2,  glyph: "x", color: "#d68f8f" },
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
