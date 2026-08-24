# Cantori — Design Document

This is the living design spec: the shape of the game we're building toward.
It's a plan, not a promise of order — we implement pieces incrementally, and
this doc gets updated as decisions firm up. Editable game *content* (monsters,
gear, classes, gods) lives in `data.js`; this file explains the *systems* those
numbers feed into.

## Vision

Cantori is a **rogue-lite** dungeon crawler: runs are permadeath, but progress
between runs persists and **opens options rather than grinding raw power**.
Meta-progression should widen the fan of choices (new classes, weapons, spells,
gods, starting kits, ways to shape the run) — not make the player numerically
stronger for its own sake. Inspiration: Hades' boon variety and Diablo's
stat-gated itemization.

## Core stats

Six stats. Each has a **main** payoff and an **auxiliary** one.

| Stat | Main | Auxiliary |
|------|------|-----------|
| **Strength** (STR) | Damage | Weapon access (equip requirements) |
| **Intelligence** (INT) | Wand & spell power | Identifying items |
| **Vitality** (VIT) | Health | Damage resistance |
| **Dexterity** (DEX) | Accuracy | Evasion |
| **Resonance** (RES) | Enchantment procs | Magic resistance |
| **Luck** (LCK) | Critical hits | A little of everything |

Stats interact with each other over time (combos, thresholds) — to be detailed
as systems land.

## Classes

Each class has a **main** and a **secondary** stat, plus a starting kit. Classes
are one of the main things meta-progression unlocks. (Current proposals live in
`data.js` → `classes` — rename/rebalance freely.)

## Leveling & advancement

- **On level up (automatic):** +2 to your main stat, +1 to your secondary, and
  **+1 free point** to spend where you like.
- **After each boss:** **+3 stat points** to distribute freely.

So growth is mostly guided by your class identity, with meaningful player choice
layered on top (the free points + boss points).

## Itemization — Diablo-style gating

Gear has **stat requirements** to equip (e.g. a heavy weapon needs STR, a finesse
weapon needs DEX), rather than Shattered Pixel Dungeon's strength-plus-upgrade
model. This makes stat investment gate *access* to gear, reinforcing class
fantasy. (Requirements are drafted in `data.js` → `gear` → `req`.)

## Boons — Hades-style, per biome

At the **start of each biome** the player picks **1 of 3 boons**, drawn from the
currently unlocked gods. Six god groups contribute to the boon pool:

| God | Domain | Availability |
|-----|--------|--------------|
| **Kethara** | Order & Domination | Starter god |
| **Maelon** | Death & Decomposition | Unlockable |
| **Ourn** | Time | Unlockable |
| **The Label** | Conjuration & Tempo | Unlockable |
| **The Guild** | Itemization & Customization | Unlockable |
| **Auvris** | Nature & Inspiration | **Sealed** — unlocks after beating the game once |

Boon lists per god are content to be authored (`data.js` → `gods` → `boons`).

## Meta-progression — the Town

Between runs, a **town you build out** spends meta-currency to **unlock options**:

- **Access unlocks:** new weapons, spells, and enchantments entering the run pools.
- **Starting kits:** ways to begin a run with chosen items / a chosen class.
- **God / faction trees:** unlock and deepen each god's boon pool.
- **Variance control:** "re-roll more, randomize less" — actions that let you
  re-roll boon/shop offers or reduce unlucky randomness (a shaping lever, not a
  power lever).

Guiding rule: unlocks **broaden choice**, they don't just crank numbers.

## Meta-currency

- **Start:** ordinary in-game **gold** doubles as the meta-currency.
- **Later:** gate deeper unlocks behind specific actions — e.g. Hades-style
  **boss kills** yielding rarer meta-components — so the biggest options require
  demonstrated progress, not just farming.

## Where content is edited

`data.js` is the single content file — monsters, gear, consumables, and the
(design-stage) stats / classes / gods tables. See its header for how to edit.

## Suggested build order (rough)

1. **Save system** — persistence on the device (needed for anything meta).
2. **Stats & classes in the run** — the six stats on the player, class select at
   run start, stat-based combat (accuracy/evasion/crits), leveling rules above.
3. **Item gating** — enforce `req` on equipment.
4. **Bosses & biomes** — biome structure, a boss per biome, boss stat rewards.
5. **Boons** — the per-biome 1-of-3 pick, starting with Kethara.
6. **The Town** — hub screen, meta-currency, unlock trees (classes, pools, gods,
   variance control).
7. **Spells / wands & enchantments** — the INT/RES side of the fantasy.

Steps can reorder; save first is the main dependency.
