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

  function rollRarity() {
    let r = Math.random();
    for (const rar of LOOT.rarities) { if (rar.chance <= 0) continue; if (r < rar.chance) return rar.key; r -= rar.chance; }
    return "white";
  }
  function maxPlusForFloor(floor) { return Math.ceil((floor || 1) / 5); }   // baseline: floor/5, round up

  // Roll a full gear instance for a base key found on a given floor.
  function rollItem(key, floor) {
    const base = GEAR[key];
    const tier = base.tier || 1;
    const rarity = rollRarity();
    const plus = randInt(0, maxPlusForFloor(floor));
    const stats = [], enchants = [];
    const ekeys = Object.keys(LOOT.enchants);
    const addStat = () => stats.push({ stat: LOOT.statPool[randInt(0, LOOT.statPool.length - 1)], val: tier });
    const addEnchant = () => enchants.push(ekeys[randInt(0, ekeys.length - 1)]);
    if (rarity === "green") { addStat(); }
    else if (rarity === "blue") { addStat(); addEnchant(); }
    else if (rarity === "purple") {
      addStat(); addEnchant();
      if (Math.random() < LOOT.purpleSecondStatChance) addStat(); else addEnchant();
    }
    // white gets nothing but its (possible) plus; gold is authored, not rolled here
    // Identification: how much use it takes to learn this item's hidden properties.
    //   idNeed = (tier + plus) * (1..10 + rarity rank),  white=1 … purple=4 … gold=5
    const rank = LOOT.rarities.findIndex((r) => r.key === rarity) + 1;
    const idNeed = (tier + plus) * (randInt(1, 10) + rank);
    const nothingHidden = plus === 0 && stats.length === 0 && enchants.length === 0;
    return { key, rarity, plus, stats, enchants, idNeed, idXp: 0, identified: nothingHidden };
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

  return { rollRarity, maxPlusForFloor, rollItem, pickCategory, pickTier, pickTypeInTierCat, pickAnyInCat, rollGearDrop };
};
