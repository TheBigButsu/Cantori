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

## Loot system — rarity + affixes + plus — DONE

Dropped gear rolls on multiple axes (config in `data.js` → `loot`; each gear piece
has a **tier** 1–3 that sets affix magnitude):

- **Rarity (color).** Rolled at drop: **White 50% · Green 30% · Blue 15% · Purple
  5%**. **Gold** (uniques) isn't in the random table — golds are hand-authored.
  - **White** — base item.
  - **Green** — + one random stat, magnitude = item tier (tier 1 → +1 … tier 3 → +3).
  - **Blue** — green + one **enchant**.
  - **Purple** — blue + one extra roll: **75% a second stat** (may duplicate) or
    **25% a second enchant**.
- **+X (plus).** Rolled on top of any rarity. It raises the item's **base atk/def
  AND every rolled affix** by X. Max +X on a floor = **⌈floor / 5⌉**.
- **Enchants** (on-hit procs). On a **weapon** they fire when you strike; on
  **armor** they fire back at whoever hits you (its "power" = armor defense).
  - **Fire** — burst = ⌈power/2⌉, then a burn for ⌈burst/2⌉ per turn over 3 turns.
  - **Electric** — burst = power, with a **stun chance = (burst × 10%) / target level**
    (a stun makes the target skip its next turn).

Equipped gear feeds the **effective stats** (`base + gear`), so a +VIT piece raises
max HP, +DEX raises accuracy/evasion, etc. The pack and character screen show the
gear bonus in green; rare drops glow in their rarity color on the floor.

_Open follow-ups: gold/unique authored items; biasing stat rolls toward a weapon's
identity (STR/DEX) instead of uniform; scaling enchant/plus numbers as content grows._

## Level-up flat bonuses — DONE

On top of the +2 main / +1 secondary / +1 free point, each class has a **levelUp**
set of flat per-level gains (`data.js` → `classes` → `levelUp`, so it's editable).
Warrior: **+5 HP, +2 MP, +2 accuracy, +2 evasion** per level. MP is now a real pool
(class `baseMp`, shown in the vitals bar) waiting on spells to spend it.

## Doors open & close — DONE

Doors (the forest **bushes** included) are now an open/close mechanism: a door is
open **only while you stand on it**, and closes behind you — so it keeps blocking
sight, and the bushes "come back" for repeat ambush setups. Thorns, once burned,
stay gone, and each level places **exactly one torch per thorn** (a strict 1:1) so
there's always fuel to clear every bramble.

## Identification — DONE

Gear is **unidentified on pickup** — you see the base type (e.g. "Sword") and its
intrinsic feel (dmg range, speed, accuracy), but its **magic is hidden**: rarity
colour, the +X, and rolled affixes don't show until you learn the item. It still
**works fully** while unidentified; you just can't read the numbers. You learn it
by **using it** (any turn it's equipped adds 1 identify-progress); it reveals once
progress reaches:

> **idNeed = (tier + plus) × (random 1–10 + rarity rank)**,  rank white=1 … purple=4 … gold=5

So rarer, higher-plus, higher-tier items take longer to identify. Truly blank items
(white, +0, no affixes — e.g. the starting kit) are known immediately. The pack
shows an "id NN%" progress tag on unidentified gear.

## Free-look camera — DONE

Swipe (or mouse-drag on desktop) to **pan the camera around the level** without
being locked to the character — **inverted**, so the camera follows your finger
(swipe right → look right). The view snaps back to the player the moment you take
any action (move, attack, wait, use). Pinch still zooms.

## Weapons: damage range, speed, accuracy — DONE

Weapons carry **dmgMin/dmgMax** (a damage range instead of a flat bonus),
**accuracy** (added to your hit chance), and **speed** (attacks per turn). Speed
runs a real **energy turn system**: an attack costs `1 / speed` time, and each
monster banks energy at its own `speed` and acts once per whole point — so a fast
dagger (speed 1.5) lets you land extra hits before the enemy swings, and a slow
mace (speed 0.7) gives the enemy free swings. Monsters can carry a `speed` too
(default 1). +X still raises dmgMin/dmgMax; accuracy/speed are fixed per type.

## Gear drops: category → tier → type — DONE

A gear drop resolves in three steps (config in `data.js` → `loot`):
1. **Category** — weighted by `categoryWeights` (weapon/armor/ring/trinket/necklace).
2. **Tier** — by floor, via `tierBands` (each band gives weights for tiers 1/2/3;
   deeper floors roll higher tiers).
3. **Type within (tier, category)** — each item's `rarity` is its % share of that
   group; items with **no** `rarity` are the **defaults** that split the remainder.
   (e.g. tier-1 weapons dagger·—, dirk·30, hammer·10 → 60 / 30 / 10.)

If a category has nothing at the chosen tier, it falls back to the nearest tier it
does have. The colour rarity (white/green/blue/purple) + affixes + plus then roll
on the chosen item as before.

## Equipment slots — DONE

Six slots feed the effective stats: **Weapon · Armor · Ring · Ring · Trinket ·
Necklace**. Weapons use `atk`, armor uses `def`; the three jewelry categories
(`ring`/`trinket`/`necklace`, in `data.js` → `gear`) carry no base atk/def — their
value is entirely rolled affixes, so they matter at Green+ rarity. Enchants on any
worn non-weapon piece fire back at attackers (jewelry's proc power = its tier +
plus). Rings fill the two ring slots in order.

## Content editor — DONE

`editor.html` + `editor.js` is a no-backend admin tool that reads the same
`data.js` and lets you edit content without code:

- **Table editors** for monsters, gear (incl. jewelry), consumables, and bosses —
  add/remove rows, typed fields, colour pickers; unknown/optional fields are
  preserved.
- **Raw-JSON panels** for biomes, classes, loot, stats, gods (the nested bits).
- **Playtest** writes the draft to `localStorage`; the game reads it on load
  (`cantori_data_override`) and shows a tap-to-clear **⚙ DRAFT** badge. **Copy for
  Claude** / **Download** produce a finished `data.js`; **Revert** restores shipped
  content. Drafts never leave the browser until exported.

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
- **Berry bushes & thorn vaults.** Forest doorways are berry bushes (red fruit
  dotted through the leaves). A separate hazard tile — **thorns** — seals off the
  occasional side room: it's passable but bites for **5–10 HP** each step through,
  and monsters refuse to enter, so a thorn vault is a player-only risk/reward
  pocket with a **choice item hidden inside** (biased toward gear or a Strength
  potion). Auto-travel never routes through thorns; you push in deliberately.
- **Torches & fire.** Wall-mounted torches light each floor (a flame plus a soft
  glow pool), placed only in ordinary rooms — never inside a thorn vault. **Tap a
  torch to take it** into your pack; then **tap an adjacent thorn (or use the torch
  from the pack) to burn the brambles away** — fire clears thorns with no HP cost,
  consuming the torch. So a vault is: bleed through for 5–10 a step, or spend a
  torch you picked up elsewhere to open it clean.

_Also still open: selecting among multiple classes at run start._

## Balance pass: curves that don't saturate — DONE

The complaint this answers: *"once I get to L4 I'm basically a god."* Every curve
that mattered was linear in a quantity that only ever went up, so each of them ran
out of road at roughly the same point in a run.

- **Hit chance no longer saturates.** It was `50% + (acc − eva) × 3%`, clamped at
  95% — reached at a 15-point lead, which a Warrior clears around level 4. Now
  `50% + 45% × tanh((acc − eva) / 20)`: the first points of accuracy are worth the
  most, the fiftieth is worth almost nothing, and neither 100% nor 0% is ever
  reached. Accuracy, evasion and every affix touching them stay live for the whole
  run, in both directions.
- **RES can no longer reach immunity.** It was a flat `1 − RES/100`, so 100 RES was
  literal invulnerability — and RES climbs on its own, from a class's secondary
  stat, Kethara's Gift of the Faithful, and gear affixes. Now `RES / (RES + 100)`:
  50 RES cuts a third, 100 RES cuts half, immunity is unreachable.
- **Monster difficulty stays authored, not multiplied.** A blanket "+x% per depth"
  over every row was tried and deliberately backed out. It re-tunes every monster
  from underneath whoever wrote it, and — worse — it hides a thin roster instead of
  showing you that it is thin. Difficulty across the run is the monsters each biome
  spawns, their `minFloor`, their `spawnMix`, and their own `acc` / `eva` / `hp`
  columns. If a late biome plays too easy, that is where the fix goes.
- **Per-level gains trimmed.** Warrior `accuracy 3 → 2`, `evasion 2 → 1`; Monk
  `accuracy 2 → 1`, `evasion 3 → 2`. Class flavour comes from the main stat (a
  Monk's `+2 DEX` a level is already `+2` to both) rather than from a flat gift.
- **Crits are a good roll, not a second attack.** Base `200% → 125%`; LCK buys
  `+0.5%` crit chance a point instead of `+1%`; and the per-level `crit` /
  `critDmg` gains are gone entirely — levels give stats and flat HP/MP, they no
  longer quietly multiply your damage. `levelUp.crit` / `levelUp.critDmg` have been
  removed from `data.js` and from the editor.
- **Early HP regen is propped up.** `×2.5` at character level 1, `×2` at 2, `×1.5`
  at 3, `×1` from 4 on (character level, not depth). The opening floors are where
  an unlucky fight is unrecoverable — no potions, empty pack — and a level-1
  character healing at the level-20 rate spent the floor walking in circles.

## Waking, bushes, tiers and boons — DONE

- **Sleepers wake sooner.** The notice roll was a flat `1/distance`, so a sleeper
  eight tiles off in plain sight took eight turns on average to look up and most
  rooms were cleared before anything in them woke. It is now `3/distance` —
  certain within three tiles, tailing off past that. Line of sight is still a hard
  requirement: the ambush is built on broken sight, and a monster that woke to
  footsteps through a wall would leave no opening to ambush into.
- **A foe in a doorway cannot dodge.** A monster standing on a door — the forest's
  **bushes** included — takes a **guaranteed hit**, alert or not, on top of the
  existing ambush auto-hit. A doorway is a one-tile gap it has to shoulder through,
  so there is nowhere to give ground to. This makes a bush worth fighting *at*
  rather than only hiding behind, and it is the reliable answer to the genuinely
  slippery foes (a Bee at eva 25) a fair roll almost never lands on.
- **The skill tree is a level-gated 5×5 board again.** Five tiers of five slots, and
  a row IS a tier: tier 1 from the start, tier 2 at character level 5, tier 3 at 10,
  tier 4 at 15, tier 5 at 20. The gate is derived from where a node sits rather than
  authored on it, so the grid means something — moving a skill down a row is how you
  make it cost more levels, and no tree can be authored with a deep skill reachable
  on the first floor. A node's own `minLevel` can raise the gate but never lower it.
  Blank cells stay blank (drawn as empty sockets) instead of closing up, because
  collapsing them would move a tier-4 skill into tier 2's row and misstate its cost.
  Prerequisites are still real requirements, and they are now spelled out in words
  on the skill's card whether or not they are met — what a skill costs is how you
  plan a build.
- **The boon choice lands on the kill.** It used to be three runes scattered on the
  boss room floor that you walked onto; the god's blessing could be looted in the
  wrong order, stepped over on the way to the stairs, or dropped somewhere a
  knockback had made unreachable. Killing the boss now opens the same 1-of-3 modal
  the run starts with, and play is blocked until you pick.

## Biomes 3–5 — planned

Content stops at biome 2 today. The next three are each meant to carry **one
structural mechanic of their own**, not just a new monster list — the biome is the
unit of variety, and the mobs get written after the level design so they can be
built around the mechanic rather than retrofitted to it.

- **Biome 3 — keys.** The way onward is locked: each floor's exit door needs a key
  found on that floor. Turns a floor from "find the stairs" into "find the key,
  then find the stairs", and gives the generator something real to hide.
- **Biome 4 — defence points.** A node on the floor is under attack and has to be
  kept alive. This is the hardest of the three by some distance — it inverts the
  game from "clear at your own pace" to "hold a position on a clock", which touches
  spawning, monster targeting (a second thing worth attacking) and the fail state.
  Worth prototyping on its own before committing the biome to it.
- **Biome 5 — auras.** A standing negative aura afflicts the player until they find
  and clear the node projecting it. The floor is hostile by default and the player
  buys their way out of it.

Monsters and bosses for each land after that biome's level design is settled.
