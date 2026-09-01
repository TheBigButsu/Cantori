/* ============================================================================
   Cantori — LOOT ROLL ENGINE (module 1 of the game.js split)
   ----------------------------------------------------------------------------
   Pure roll logic: given the content tables (GEAR / LOOT) and a randInt, decide
   what a gear drop is — its category, tier (by floor), type-within-tier, rarity
   colour, affixes, +X, and identify threshold. It touches NO game state (no map,
   player, monsters), which is exactly why it lives on its own.

   Usage (from game.js):
     const _loot = window.CantoriLoot({ GEAR, GEAR_KEYS, LOOT, randInt });
     const rollItem = _loot.rollItem, rollGearDrop = _loot.rollGearDrop, ...
   ========================================================================== */
window.CantoriLoot = function (deps) {
  "use strict";
  const GEAR = deps.GEAR, GEAR_KEYS = deps.GEAR_KEYS, LOOT = deps.LOOT, randInt = deps.randInt;
  // Optional overrides (e.g. Guild boons in game.js). Both default to pure
  // behavior — this module stays stateless unless a caller opts in.
  //   getRarityWeights() -> { white, green, blue, purple, gold } | null   (Guild's Blessing)
  //   rollPlus(floor)    -> integer plus | null                          (Guild's Refinement)
  const getRarityWeights = typeof deps.getRarityWeights === "function" ? deps.getRarityWeights : null;
  const rollPlusOverride = typeof deps.rollPlus === "function" ? deps.rollPlus : null;

  function rollRarity() {
    const override = getRarityWeights && getRarityWeights();
    if (override) return rollRarityFrom(override);
    let r = Math.random();
    for (const rar of LOOT.rarities) { if (rar.chance <= 0) continue; if (r < rar.chance) return rar.key; r -= rar.chance; }
    return "white";
  }
  // Roll a rarity from a { key: weight } table (used for the trinket floor:
  // blue/purple/gold only). Empty/zero falls back to blue.
  function rollRarityFrom(dist) {
    const keys = Object.keys(dist || {});
    let total = 0; for (const k of keys) total += Math.max(0, dist[k]);
    if (total <= 0) return "blue";
    let r = Math.random() * total;
    for (const k of keys) { r -= Math.max(0, dist[k]); if (r <= 0) return k; }
    return keys[keys.length - 1];
  }
  function maxPlusForFloor(floor) { return Math.ceil((floor || 1) / 5); }   // baseline: floor/5, round up

  // Roll a full gear instance for a base key found on a given floor. `forcedRarity`
  // (optional) overrides the normal rarity roll — used for the boss trinket floor.
  function rollItem(key, floor, forcedRarity) {
    const base = GEAR[key];
    const tier = base.tier || 1;
    const rarity = forcedRarity || rollRarity();
    const overridePlus = rollPlusOverride && rollPlusOverride(floor);
    const plus = (overridePlus != null) ? overridePlus : randInt(0, maxPlusForFloor(floor));
    const stats = [], enchants = [];
    // enchants eligible for this item's category (respecting each enchant's `slots`)
    const ekeys = Object.keys(LOOT.enchants).filter((k) => { const s = LOOT.enchants[k].slots; return !s || s.indexOf(base.cat) >= 0; });
    const addStat = () => stats.push({ stat: LOOT.statPool[randInt(0, LOOT.statPool.length - 1)], val: tier });
    const addEnchant = () => { if (ekeys.length) enchants.push(ekeys[randInt(0, ekeys.length - 1)]); };
    if (rarity === "green") { addStat(); }
    else if (rarity === "blue") { addStat(); addEnchant(); }
    else if (rarity === "purple") {
      addStat(); addEnchant();
      if (Math.random() < LOOT.purpleSecondStatChance) addStat(); else addEnchant();
    }
    else if (rarity === "gold") { addStat(); addStat(); addEnchant(); addEnchant(); }   // gold: the richest roll
    // white gets nothing but its (possible) plus.
    // Jewelry is worthless as a bare item, so a ring / trinket / necklace always
    // carries at least one property — roll an enchant if it can, otherwise a stat.
    const JEWELRY = { ring: 1, trinket: 1, necklace: 1 };
    if (JEWELRY[base.cat] && stats.length === 0 && enchants.length === 0) {
      if (ekeys.length && Math.random() < 0.5) addEnchant(); else addStat();
    }
    // Identification: how much use it takes to learn this item's hidden properties.
    //   idNeed = (tier + plus) * (1..10 + rarity rank) * 3,  white=1 … purple=4 … gold=5
    // The ×3 keeps it from resolving inside a single fight (a white tier-1 item used to
    // average ~6-7 hits — one or two fights — to fully identify).
    const rank = LOOT.rarities.findIndex((r) => r.key === rarity) + 1;
    const idNeed = (tier + plus) * (randInt(1, 10) + (rank > 0 ? rank : 5)) * 3;
    const nothingHidden = plus === 0 && stats.length === 0 && enchants.length === 0;
    const inst = { key, rarity, plus, stats, enchants, idNeed, idXp: 0, identified: nothingHidden };
    // A base with `variants` picks one at drop (e.g. the Metrognome's walk/attack mode).
    if (Array.isArray(base.variants) && base.variants.length) inst.variant = base.variants[randInt(0, base.variants.length - 1)];
    return inst;
  }
  // Boss / special drop: a trinket, never below blue (blue/purple/gold per the
  // trinketRarity table). Trinkets never come from the normal category pool.
  function rollTrinket(floor) {
    const trinkets = GEAR_KEYS.filter((k) => GEAR[k].cat === "trinket");
    if (!trinkets.length) return null;
    const key = trinkets[randInt(0, trinkets.length - 1)];
    const rarity = rollRarityFrom(LOOT.trinketRarity || { blue: 40, purple: 40, gold: 20 });
    return rollItem(key, floor, rarity);
  }

  // ---- Gear drop pipeline: category -> tier (by floor) -> type (within tier) ---
  function pickCategory() {
    const cw = LOOT.categoryWeights || { weapon: 1 };
    const keys = Object.keys(cw);
    let total = 0; for (const k of keys) total += cw[k];
    let roll = Math.random() * total;
    for (const k of keys) { roll -= cw[k]; if (roll <= 0) return k; }
    return keys[0];
  }
  function pickTier(floor) {
    const bands = LOOT.tierBands || [{ upToFloor: 99, weights: [1, 1, 1] }];
    const band = bands.find((b) => floor <= b.upToFloor) || bands[bands.length - 1];
    const w = band.weights || [1, 1, 1];
    let total = 0; for (const x of w) total += x;
    if (total <= 0) return 1;
    let roll = Math.random() * total;
    for (let i = 0; i < w.length; i++) { roll -= w[i]; if (roll <= 0) return i + 1; }
    return 1;
  }
  // Within a (category, tier) group: items with an explicit `rarity` use it as a %;
  // the rest are defaults that split whatever % is left.
  function pickTypeInTierCat(cat, tier) {
    const items = GEAR_KEYS.filter((k) => GEAR[k].cat === cat && (GEAR[k].tier || 1) === tier);
    if (!items.length) return null;
    const explicitSum = items.reduce((a, k) => a + (GEAR[k].rarity != null ? Math.max(0, GEAR[k].rarity) : 0), 0);
    const defaults = items.filter((k) => GEAR[k].rarity == null);
    const rem = Math.max(0, 100 - explicitSum);
    const w = {};
    for (const k of items) w[k] = GEAR[k].rarity != null ? Math.max(0, GEAR[k].rarity) : (defaults.length ? rem / defaults.length : 0);
    let total = 0; for (const k of items) total += w[k];
    if (total <= 0) { for (const k of items) w[k] = 1; total = items.length; }   // all-zero → even
    let roll = Math.random() * total;
    for (const k of items) { roll -= w[k]; if (roll <= 0) return k; }
    return items[items.length - 1];
  }
  // Fallback when a category has nothing at the requested tier: pick from the
  // nearest tier that exists (so a deep ring drop uses the highest ring available).
  function pickAnyInCat(cat, tier) {
    const items = GEAR_KEYS.filter((k) => GEAR[k].cat === cat);
    if (!items.length) return null;
    let best = [], bestDist = Infinity;
    for (const k of items) {
      const dt = Math.abs((GEAR[k].tier || 1) - tier);
      if (dt < bestDist) { bestDist = dt; best = [k]; }
      else if (dt === bestDist) best.push(k);
    }
    return best[randInt(0, best.length - 1)];
  }
  // Full gear drop for a floor → a rolled instance (rarity colour + affixes + plus).
  function rollGearDrop(floor) {
    const cat = pickCategory();
    const tier = pickTier(floor);
    const key = pickTypeInTierCat(cat, tier) || pickAnyInCat(cat, tier) || GEAR_KEYS[0];
    return rollItem(key, floor);
  }

  return { rollRarity, rollRarityFrom, maxPlusForFloor, rollItem, rollTrinket, pickCategory, pickTier, pickTypeInTierCat, pickAnyInCat, rollGearDrop };
};
