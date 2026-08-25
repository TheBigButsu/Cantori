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

## Implemented so far (current v1 numbers — tune freely)

- **Warrior** is the only class (single-class focus). Base stats STR 8 / VIT 7 /
  DEX 4 / INT 3 / RES 3 / LCK 4; starts wielding a Sword and Leather Armor.
- **Derived effects wired:** STR → damage, gated by the wielded weapon:
  +⌊(STR − weaponSTRreq)/4⌋ (so a Warrior nets ~+1 damage every 2 levels, and a
  weapon you barely meet gives no bonus). VIT → max HP (6 + VIT×2) and −⌊VIT/5⌋
  damage taken. DEX → **accuracy (10 + DEX)** and **evasion (1 + DEX)**. INT / RES /
  LCK are tracked but not yet used (await spells / enchants / crits).

- **Accuracy vs evasion:** every strike rolls hit chance = `acc / (acc + eva)`
  (attacker accuracy vs defender evasion) instead of a flat dodge. Monsters carry
  their own `acc`/`eva` in `data.js` (default 12/4). This makes high-evasion foes
  like the Bee (eva 16) genuinely slippery — a Warrior lands only ~half his blows.
- **Surprise (ambush) auto-hit:** a monster that has never seen you (`aware` is
  false — line of sight broken by a wall or door) takes a **guaranteed hit for 1.5×
  damage** when you strike first. This is the intentional-play answer to evasive
  enemies: break sight, close in, and open with a certain, heavy blow. A monster
  becomes `aware` the moment it can see you, so the ambush is a one-time opening.

- **Weapon STR requirements** (Diablo-style, `data.js` → `gear` → `req`): Dagger 0
  / Sword 4 / Mace 8 STR; armor Leather 0 / Chain 4 / Plate 8. Currently the
  requirement feeds the **damage formula** (under-meeting a weapon zeroes the STR
  bonus); hard equip-gating (refuse to wield below req) is a later step.
- **Leveling:** +2 main stat, +1 secondary, +1 banked point per level; +3 banked
  points per boss. Banked points accumulate for the **skill tree (next)**.
- Strength potion now grants +1 STR (permanent).

- **XP anti-grind:** every monster has a level (= its floor). Killing something
  2+ levels below you gives 50% XP; 4+ below gives 0.
- **Full-room visibility** (SPD style): FOV is line-of-sight bound, not radius
  bound — the room you're in lights up fully; only walls block sight.

## Character screen, hotbar, examine, Warrior tree — DONE

**Character screen** (👤) with tabs **Stats · Skills · Boons**; a **hotbar**
(Wait + learned skills, with live cooldowns); an **examine** tool (🔍) to inspect
any visible tile. Banked points are spent on the skill tree.

**Warrior skills** (implemented; spend banked points):
- **Rush** — dash in a direction until you collide. Hit a monster → damage it;
  hit a wall → damage yourself. Cooldown 100 turns.
  - 1 pt: unlock, +0 damage · 2 pts: +3 damage · 3 pts: +5 damage and −50 cooldown
- **Spin** — strike all adjacent monsters. Cooldown 80 turns.
  - 1 pt: unlock, +0 damage · 2 pts: +1 damage · 3 pts: +1 damage and +1 range
    (hits everything within 2 tiles)

## Doors & the HUD frame — DONE

- **Doors at hall entrances.** Every 1-tile-wide gap a corridor punches through a
  room's wall becomes a **door** (`data.js` → `biomes` → `door`: the Forest uses
  **bushes**, other biomes a plank/stone panel — drawn procedurally, no new art).
  A **closed** door blocks line of sight both ways, so a room stays dark until you
  reach its threshold; stepping onto a door **opens it** (permanently). This is the
  structural half of the surprise system: approach through a closed door and the
  foes inside are still `unaware` → your opening blow is a guaranteed ambush hit.
- **HUD frame.** Zoom buttons are gone (pinch / scroll-wheel still zoom); the right
  rail is 👤 Character · 🎒 Pack · 🔍 Examine · ▦ Map. The top bar shows **Lv**, an
  **enemies-in-sight counter** (☠ N, SPD-style), and the biome/depth. HP/MP/Food
  live in a **bottom-left vitals stack** so the notch can crop the top bar harmlessly.
  MP and Food are placeholders pinned at 100 until spells and hunger land.
- **Examine auto-closes** after one inspection — tap 🔍, tap a tile, done.

_Also still open: selecting among multiple classes at run start._
