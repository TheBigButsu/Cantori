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
by **using it** — one swing of that weapon, or one hit taken while wearing that
armor, adds 1 identify-progress. Walking around equipped adds nothing. It reveals
once progress reaches:

> **idNeed = round((tier + plus) × (random 1–10 + rarity rank) × 0.5)**,  rank white=1 … gold=5

So rarer, higher-plus, higher-tier items take longer to identify: a tier-1 white
runs 1–6 uses, a tier-3 blue 6–20, a tier-5 gold +2 21–52. Truly blank items
(white, +0, no affixes — e.g. the starting kit) are known immediately. The pack
shows an "id NN%" progress tag on unidentified gear.

The `× 0.5` (`ID_EFFORT` in `loot.js`) is the only dial here, and it has moved a
long way. It was `× 3`, chosen so identification wouldn't resolve inside a single
fight — but that reasoning assumed a use was a turn. It isn't; it is a *connecting
blow*. The real cost was three times what it read as, putting an ordinary blue at
~76 landed hits, so most gear was outgrown and replaced before it ever revealed
itself and the affix system stayed invisible. Note also that both this document and
the editor's formula reference omitted the `× 3` entirely for as long as it existed.

**Still crooked:** `plus` sits inside the multiplier, so pouring Scrolls of Upgrade
into a weapon makes it *harder* to learn. That is backwards — investment should not
buy opacity — but it is left alone for now rather than folded into a speed change.

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
  **enemies-in-sight counter** (☠ N, SPD-style), and the biome/depth. HP/MP/TIME
  live in a **bottom-left vitals stack** so the notch can crop the top bar harmlessly.
  MP was a placeholder pinned at 100 until spells landed. The third bar was **Food**,
  pinned at 100/100 doing nothing while hunger stayed unbuilt; it is now **TIME** —
  the floor's patience, counting down (see the Horror, below).
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

- **Hit chance no longer saturates, and a point of lead is worth ~1%, not 3%.** It
  was `50% + (acc − eva) × 3%`, clamped at 95% — a 15-point lead, which a Warrior
  clears around level 4. Now `50% + 45% × tanh((acc − eva) / 45)`. Over normal
  leads that is within a point of a straight 1%/point; it only bends beyond about
  20, and it never arrives at certainty. Both halves matter: the gentler slope
  stops accuracy from outrunning the monster roster, and the missing ceiling
  leaves headroom for a monster's `eva` to keep mattering. Under the old rule a
  Snake at eva 30 was a 95% hit from level 12 on — indistinguishable from a Rat;
  it is now 61% at 12, 66% at 15 and still only 80% at 25.
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
- **Skills are level-gated by tier.** Tier 1 from the start, tier 2 at character
  level 5, tier 3 at 10, tier 4 at 15, tier 5 at 20. The gate is derived from the
  row a node is authored on rather than set per node, so moving a skill down a row
  in the editor is how you make it cost more levels, and no tree can be authored
  with a deep skill reachable on the first floor. A node's own `minLevel` can raise
  the gate but never lower it. Prerequisites are still real requirements, and they
  are spelled out in words on the skill's card whether or not they are met — what a
  skill costs is how you plan a build.
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

## The floor's patience — the Horror — DONE

A floor tolerates you for **1000 turns**. A warning lands at 900 ("the air goes
wrong"); at 1000 something comes after you, and it does not stop coming.

This is the anti-grind, and it is deliberately **a monster rather than a rule**. A
hard XP cutoff per monster (Shattered Pixel Dungeon's `maxLvl`) or a forced descent
would both work arithmetically, but neither can be played around. A hunter can: run
from it, break line of sight to buy distance, fight it if you have the resources,
or — the intended read — take the stairs. Grinding stops being *disallowed* and
starts being *expensive*, which is the answer the ambush system already gives
everywhere else in the game.

- **What arrives** is authored per biome: `horror` in `data.js` names a monster key,
  and `horrorName` is what it is called when it shows up. Blank falls back to the
  biome's deepest-starting monster, so a biome that has not been given one yet still
  sends its scariest resident rather than nothing. It reuses that monster's sprite,
  so no new art ships with the mechanic.
- **How it differs** from the animal it wears: ×3 max HP, ×4 attack, and it never
  loses the trail. Every other monster gives up after 10 turns without line of
  sight; the Horror does not.
- **It is worth 0 XP.** This one is load-bearing. Paying XP for a Horror would
  invert the mechanic exactly — farming them would become the most efficient grind
  in the game, on the floor the player was supposed to leave.
- **Killing it buys 60 turns**, then the next one comes. Not the floor back.
- It stays out of boss floors and the merchant den, which have their own pressure,
  and the clock (`turns`, already reset by `generateLevel`) restarts every floor.
- **The clock is visible.** The third vitals bar — the old **Food** placeholder,
  which sat pinned at 100/100 while hunger stayed unbuilt — is now **TIME**, and it
  drains as you spend the floor's welcome. It shows turns remaining rather than a
  percentage, because it is the only warning the player gets that they are on a
  clock, and it turns red at the same moment the log does. On a floor with no clock
  (boss, merchant) it reads "—" and dims rather than faking a countdown.

Still open: the XP curve is `level × 6` and nothing else caps levelling, so the
Horror is the only brake. If a run still over-levels, `FLOOR_PATIENCE` is the dial.

## Skills: a tiered selector, not a node graph — DONE

The Skills tab drew the tree as a node graph: circles on an absolutely-positioned
5×5 board, with an SVG layer drawing an arrow per prerequisite. It is gone.

It did not survive contact with a phone. The board was wider than the character
card at 430px, so half the tree lived behind a horizontal scroll; the arrows
crossed each other as soon as a node had two parents; and the empty sockets of
tiers the character could not reach for another fifteen levels took up most of the
screen. It looked like a diagram of the data rather than a thing to use.

It is now a **Shattered-Pixel-style tiered selector**: one row per tier, each row a
header (the tier and its level gate) above a wrap of compact cells — icon, name,
and rank pips. Tap a cell to select it; the detail card below is unchanged and
carries the description, the current and next rank, the requirement line and the
Learn/Upgrade button. Nothing scrolls sideways.

What was lost with the arrows is nothing: an arrow could say "this one" but never
"this one, **maxed**", which is what the tier-2 gate actually asks for. The
requirement line says it in words, and always — met or not.

The underlying data is untouched. Nodes still carry `x`/`y`; `y` is the tier (its
level gate) and `x` is now just the order cells appear in the row. The editor's
authoring grid is unchanged, and so is every prerequisite in `data.js`. Only tiers
that hold at least one skill are drawn — an empty tier is not information.

## Boss arenas — DONE

Boss floors are **built, not rolled**. Each boss names its layout (`arena` on the
bosses table); anything unset gets the hall.

- **`ring`** (the Piper) — 4–5 chambers on a circle, joined rim to rim in a closed
  loop, with the boss in the chamber opposite the one you walk in from. Every room
  has two ways out, so the fight can be kited round the ring rather than fought in
  a corner.
- **`hall`** (the Golem) — an antechamber and a short corridor into one great
  pillared room, boss at its centre, rubble scattered for texture.

### The bug this fixes

About **1 boss floor in 200** generated with the boss sealed inside a 1-tile pocket
of obstacle trees — an unwinnable run, because the exit only opens when the boss
dies. `tests/smoke.js` caught it as an intermittent `boss is unreachable on foot`,
failing roughly one run in five.

The cause was `placeTrees`, which drops `1 + (area − 21)/5` pillars into any room
over 20 tiles. Boss rooms were 70–170 tiles, so they earned **15–30 pillars**, and
occasionally those closed a ring around the boss. Measured before the fix: 7
strandings in 1500 boss floors, every sample showing the boss with 7–8 wall
neighbours in a pocket of 1–2 tiles.

The existing terrain safety net could not catch it. It only ran `if
(paintedCells.length)` — so it never fired at all in a biome with no `terrain`
block, which is three of the five — and its only remedy was `unpaintTerrain()`,
which removes water and rubble but never a tree.

The fix is structural rather than another check: **boss floors do not run the tree
pass at all**, and both arenas are laid out so connectivity is a property of the
shape. The ring is a closed loop. The hall's colonnade sits on a 3-tile lattice of
*single* tiles, so every pillar is an island with two clear tiles around it and the
floor stays one connected mesh whichever pillars are dropped. Thorn vaults and
traps are skipped on boss floors too.

A backstop remains for a future arena that gets this wrong: if the boss is somehow
unreachable, carve a corridor to it. Unlike the terrain check it can actually
repair the floor, because carving is always available where removing terrain is
not. It does not fire on either arena today — measured 0 strandings in 1500.

## D&D-style ability modifiers — DONE (partly)

Stats no longer feed formulas raw. Everything reads the **modifier**,
`floor((score − 10) / 2)`, and stat blocks are the 5e **standard array**
(15/14/13/12/10/8), so a starting character's modifiers run −1 … +2 and 10 is the
do-nothing middle.

| Class | STR | INT | VIT | DEX | RES | LCK |
|---|---|---|---|---|---|---|
| Chadwick (warrior) | 15 | 8 | 14 | 12 | 13 | 10 |
| Brynn (monk) | 12 | 8 | 14 | 15 | 13 | 10 |
| ToneTum (mage) | 8 | 15 | 10 | 12 | 14 | 13 |
| *Bard (not built yet)* | *12* | *14* | *15* | *10* | *8* | *13* |

This was not a substitution. The old formulas read raw stats of 3–60 directly, so
each needed its own scale chosen for a range that now spans four points:

| | Old | New |
|---|---|---|
| STR → damage | `floor((STR − weapon req) / 4)` | `mod(STR)` — the requirement already hard-gates equipping |
| VIT → HP | `+1 per point` | `+1 per point of modifier`, flat |
| INT → MP | `+1 per point` | `+1 per point of modifier`, flat |
| DEX → acc/eva | `+1 each per point` | `+mod(DEX)` each |
| RES → damage taken | `RES / (RES + 100)` | `m / (m + 10)`, m = mod(RES) — +2 cuts 17%, +10 cuts 50% |
| LCK → crit | `+0.5%/point`, `+2% crit dmg` | `+2%/mod point`, `+5% crit dmg` |
| LCK → enchant procs | `+1%/point` | `+3%/mod point` |

**One thing tried and rejected:** applying VIT per level, the way 5e adds CON to
every hit die. That is linear in D&D because stats barely move there (an ASI every
four levels, hard cap 20). Here a class's main stat gains **+2 every level**, so VIT
reaches 33 by level 20, its modifier +11, and `mod × level` goes quadratic — **333
max HP at level 20** against 20 at level 1. Modifiers are flat bonuses; per-level
growth stays the `levelUp` set's job.

### RESOLVED: stat growth, and the whole to-hit system — see below

The two "still open" notes in this section are settled; the sections that follow
supersede them. Kept here because the reasoning still explains *why*.

### (superseded) How stats should grow

The level-up rule is untouched — **+2 main, +1 secondary, every level**. That is not
a D&D curve, and it is the next domino. It means a main stat reaches 53 by level 20
(modifier +21), so modifiers are not the bounded ±5 things they are in 5e; they are
just a slower-growing version of the old raw stats. If the intent is genuinely
D&D-shaped, level-ups want to become an ASI: +2 to one stat every 4 levels, capped
at 20, which holds every modifier at +5 or under for the whole run.

### (superseded) Accuracy and evasion were on the wrong scale for this

See the note in the editor's formula reference. `mod(DEX)` spans **−1 … +2 across
every class in the game** — a 3-point total spread. On the current hit curve
(`50% + 45% × tanh(lead / 45)`) 3 points of lead is worth **3 percentage points**.
The same 3 points on a d20 is **15**. Meanwhile weapon accuracy spans −15 … +9 and
monster evasion 0 … 30, so weapon choice and level decide whether you hit and DEX is
a rounding error.

Making DEX matter means moving three things together, which is the deferred monster
pass: `HIT_SCALE` down to about **9** (so a point of modifier is worth ~5 points,
like a d20), monster `eva` re-authored onto an AC-like **10–20** band instead of
0–30, and weapon accuracy onto a proficiency-like **±3** instead of ±15. Doing only
the first makes the game unplayable: at scale 9, a Snake at eva 30 against a level-1
accuracy of 17 is a **10%** hit.

## d20 to-hit and Armour Class — DONE

The tanh hit curve is gone. A hit is now **`d20 + to-hit ≥ the target's AC`**, with a
natural 1 always missing and a natural 20 always hitting, so every exchange stays
between 5% and 95%.

This had to follow the ability modifiers. On the old curve, `mod(DEX)` spanning
−1…+2 was worth **3 percentage points** across the entire stat; on a d20 the same
spread is **15**, which is the whole reason 5e's modifiers can be small numbers.

- **To hit** = proficiency + `mod(DEX)` + the weapon's `toHit` + boons + passives.
  Proficiency is 5e's: **+2, rising by one every four levels** (+2 at 1–4, +3 at
  5–8, … +6 at 17+). There is no per-level accuracy any more — `levelUp.accuracy`
  and `levelUp.evasion` are removed from every class, because +2 to-hit a level is
  +10 percentage points a level and would cap out by about level 6.
- **AC** = 10 + `min(mod(DEX), subtype cap)` + the armour's `ac` + boons + passives.
  Light armour lets the whole DEX modifier through, **medium caps it at +2, heavy
  takes none** — which is what stops plate being strictly best. Heavy buys that back
  with flat mitigation (light +0, medium +1, heavy +3 damage soaked), which is this
  game's own addition on top of AC.

Monsters carry `toHit` and `ac` instead of `acc` and `eva`, converted from the old
columns as `AC = 10 + eva/4` and `toHit = acc/4`, which lands them in a 10–18 AC
band and a +0…+5 to-hit band. Weapons' `accuracy` became `toHit` at a third of its
old value (dagger +3, sword +2, big axe −5). Armour got explicit AC on the new
scale (cloth/Shitty +1, leather +2, chain +3, plate +4). Bosses were given an
authored ladder rather than defaulting: Piper AC 14/+5, Golem 16/+6, Mummy 15/+7,
Cultist 16/+8, Demigod 17/+9.

## Stat growth — DONE

**Main stat +1 every 2 levels, secondary +1 every 3.** It was +2 and +1 *every*
level, which drove a main stat to 53 by level 20 — a +21 modifier, nothing like the
bounded thing `(score − 10) / 2` assumes. At this rate a main stat gains 10 points
over 20 levels and its modifier tops out near +7. HP and MP still rise every level
through the `levelUp` set; only the stats slowed down.

## Armour: three identities, not three points on one axis — DONE

Armour was the weakest drop in the game: every piece was "more AC, more soak", so a
new one was interesting only if the number was bigger. The three subtypes are now
three different answers to *how do I not die*.

- **Light** — a caster's robe. Grants **INT (= its tier) and MP** outright, thin
  mitigation, and **no AC at all**. *Grass armor, Cloth armor, Refined robe, Mages
  robe, Threads of fate.*
- **Medium** — the only armour that turns DEX into AC, and so the only place AC is a
  live stat. It lets through **tier + plus** points of your DEX modifier: a tier-1
  jerkin caps you at +1 however nimble you are, and **each upgrade scroll widens what
  your DEX is allowed to do**. Spending past your own modifier is wasted — the cap
  never invents DEX you do not have. *Padded jerkin, Studded leather, Scale hauberk,
  Elven mail, Windwoven coat.*
- **Heavy** — no AC, no DEX, the largest mitigation ranges in the game. You get hit;
  it barely matters. *Rusted mail, Chainmail, Banded plate, Knight's plate, Adamant
  bulwark.*

Mitigation is the item's own min–max roll (no subtype bonus any more), exponential
with widening gaps so a **tier** jump is felt more than an upgrade scroll:

| | t1 | t2 | t3 | t4 | t5 |
|---|---|---|---|---|---|
| light | 0–2 | 0–4 | 1–7 | 2–11 | 3–17 |
| medium | 1–3 | 2–6 | 3–10 | 5–16 | 7–24 |
| heavy | 2–5 | 4–9 | 6–15 | 9–23 | 13–34 |

**Armour's `+X` runs the opposite way to a weapon's.** A weapon's plus opens its top
end; armour's raises the floor fast and the ceiling slowly, and the ceiling can at
most double: `min += floor((plus+1)/2)`, `max = min(2 × base max, base max + plus)`.
Upgrading armour should make it *dependable*, not spiky — a +3 tier-1 robe is a
reliable 2–4, not a wild 0–8. Light tier 1 therefore runs 0–2 / 1–3 / 1–4 / 2–4
across +0…+3.

## ToneTum's spellbook — DONE

Seven skills, all authored in `data.js` — costs, cooldowns, thresholds and durations
are rank data, never hardcoded.

**Magic Missile** is **innate**: known from level 0, costs no skill point. 5 MP for
1–4 damage plus one per character level. A new node flag, `innate`, carries this (and
the editor learned it in the same commit — rule 2 caught it the first time round).

**Tier 1** — *Burning Sensation* (passive; every connecting blow or bolt sets a burn,
1/3 turns rising to 4/6), *Sleep* (10 MP; drops a foe at or below INT ÷ 2 HP, then
INT, then a 5-tile cross), *Deep Well* (passive; +10/25/50/100% MP regen, ranks
replacing rather than stacking, the top two gated at character level 5 and 10).

**Tier 2** — *Blink* (teleport anywhere in sight; ranks cut the cost 20 → 15 → 10 MP
and make kills burn the cooldown down), *Mirror Image*, *Madness* (berserk for
INT-modifier turns, cooldown 250 → 100).

### Two things that needed engine work

**Sleep had to hold.** The first build was useless: the sleeper got its ordinary
notice roll on the very turn the spell landed, and `WAKE_ACUITY` makes that a
certainty within three tiles — exactly where you would ever cast it. Magical sleep is
now its own state (`magicSleep`, 10 turns + the INT modifier) during which the monster
gets no notice roll at all and noise cannot reach it. A blow still breaks it
instantly, which is the point: a sleeper is `unaware`, so the existing ambush rule
already makes your next strike on it a guaranteed hit.

**Mirror Image needed a third kind of thing on the board.** Decoys are not monsters
(they never act, hold no HP worth tracking and give no XP) and not the player, so they
live in their own `decoys` list. A hunting monster adjacent to one strikes it instead
of you and the image shatters — always, on one hit. Only *adjacency* is checked: an
image that pulled monsters across the room would be a wall, not a feint. They are
drawn as the player's own sprite at half alpha with a blue outline, because a decoy
you cannot tell from yourself is a UI bug rather than a mind game.

## Burning Sensation is a spell now — DONE

The passive version was a tax on every attack: it did its work whether or not you
wanted it, so it never asked for a decision. As a cast it does. **7 MP, 20-turn
cooldown**, and it sets a burn whose damage *starts* at your INT modifier and drops
by one every turn until it goes out — so it runs for exactly as many turns as its
opening tick, and the total is the triangular number of that opening tick.

| INT mod | opening tick | turns | total |
|---|---|---|---|
| +2 | 2 | 2 | 3 |
| +3 | 3 | 3 | 6 |
| +4 | 4 | 4 | 10 |

Ranks add to both ends: rank 2 gives +1 damage, rank 3 also +1 turn, rank 4 gives +3
and +3. At rank 4 with a +4 modifier that is a 7-damage opening tick running 10 turns
for 31 total — a real opener against something slow, still worthless against something
that reaches you in two steps.

The decay needed a new DOT flag rather than a new DOT type. Burns already ran off
`rounds`; `decay: true` simply subtracts one from `dmg` on each tick (floored at 1, so
a rank-4 burn's tail is a long 1-a-turn drip rather than a sudden nothing). Poison
still counts *down its damage* as its clock, which is why the tick handles the two
shapes separately.

One consequence worth knowing at the table: casting spends a world turn, so the burn
ticks once immediately. A 3-damage burn is first *seen* at 2. The 3 was dealt.

## Charge damage lands after mitigation — DONE

The bear's charge added its per-square bonus to the raw roll and then let armour eat
the sum, which meant the whole mechanic quietly vanished against anything armoured:
against tier-3 Banded plate **every single charge landed for exactly 1**. The bonus is
now added *after* resistance and armour block:

```
dmg = max(1, round(roll × (1 − res)) − armourBlock) + bonus
```

Momentum is momentum — a bear that crossed five squares hits harder than one that
crossed one, and plate does not care how it was run into. Same fight, after: charges
average 4.5 instead of 1.0. This applies to any charger, not just the bear; it is the
shared `attack()` path.

## Piper beam cooldown 7 → 12

Worth recording because the request was to slow "the summon skill": the Piper's two
vermin summons are **one-shot events**, not cooldowns — one on first sight, one at
half HP via `piperPhaseShift`. The beam is the only recurring ability it has, and that
is what moved.

## Biome 3: the crypt's five — DONE

The Mummy's Crypt had four monsters, all of them variations on "walks at you and
bites". Five more, and between them they make the crypt about *your turn* rather
than your hit points: three of the five take the turn away instead of taking HP off.

### Red Slime and Black Slime — an aura is a thing you HAVE

Range 3, and the field is on whether or not the slime has noticed you: a red one
doubles what every step costs, a black one adds half again to every swing. They are
slow (walk 0.6) and reasonably tough on purpose — a fast slime would just be a bad
wolf, and the whole creature is a piece of ground you would rather not fight on.

Three scalars on the data row do it — `auraRange`, `auraWalk`, `auraAttack` — and
they fold into `walkCost()` / `attackCost()` at exactly the point haste already
divides them. Haste divides, an aura multiplies; several auras compound, so two red
slimes are worse than one.

**The rule that makes it fair: an aura only applies from a slime you can SEE.** An
unexplained tax on your movement, arriving from a creature in an unlit room two
corners away, is not a mechanic — it is a bug report. The tiles inside the field are
tinted in the slime's own colour, the multiplier shows as a chip under the vitals
bars, and the log says once when the mix of fields you are standing in changes.

### Hollow Acolyte — it does its real work dying

14 HP. It wants to die, and it wants to die next to you. The burst is 1..the current
depth, rolled *per victim*, and every victim takes the same blow four further ways:
a burn at half, a poison at half, mana torn off at all of it, and 1–2 turns of stun
on top. Monsters inside the radius are caught too, so a burst can chain through a
pack (once — recursion is blocked, so a chain resolves rather than looping).

Killing one beside you is a mistake. Killing one in a crowd is a tactic. That is the
whole design, and it is why it is fragile enough to pop on a single hit.

This needed **burn and poison that land on the player**, which had never existed —
monsters have carried both since the beginning, but nothing could put either on you.
They are the mirror of the monster tick, not a new idea: a burn cools by 1 a turn to
a floor of 1 and lasts as many turns as its opening tick (so 4 damage is 4+3+2+1 =
10), and a poison stack deals its whole total each turn and decays by 1.

### Brute — charge

Pure data: 40 HP, `charge: true`, and it inherits the momentum bonus the bear got
last week, which now lands after mitigation. Nothing in the engine had to move,
which is the framework working.

### Hollow Bard — five ways to lose a turn

Ranged, range 5, and on a **connecting** hit (never a miss — the song has to reach
you) it has a 35% chance to land one of five hexes:

| Hex | What it does | Lasts |
|---|---|---|
| **Hex** | a blow of yours that already *connected* still slides off, half the time | floor number |
| **Blind** | sight radius halved, 8 → 4, lighting falloff with it | floor number |
| **Vertigo** | the direction you press is replaced by a random one of the eight | 3 turns |
| **Charmed** | you cannot attack the singer, melee or bow, until something hurts you | floor number |
| **Berserk** | your input is discarded; you go at the nearest thing and hit it | 3–5 turns |

Which of them a monster can sing is a comma-separated pick-list on its row
(`hexes`), so a future biome-4 creature can take two of these and none of the rest
without touching code.

Four details worth writing down, because each was a decision rather than an
implementation:

**Hex sits AFTER the to-hit roll, not as a penalty to it.** That is what makes it
defeat a *guaranteed* hit as well: an ambush and a foe pinned in a doorway are
certain against the foe's dodging, and a hex is not the foe.

**Vertigo cancels auto-travel outright** rather than staggering you along the path.
A route you cannot walk straight is not a route, and watching the game lurch you
down one for twenty tiles is worse than being told to walk it yourself.

**Charmed breaks on ANY damage, not just the singer's next arrow.** There is no one
funnel every source of player damage passes through — a trap, a burst, the brambles,
a burn still ticking — so rather than remembering to break it at a dozen call sites
(and missing the next one added), it watches the HP itself, once at the end of each
world turn. The singer's own blow breaks it inline a few lines earlier, which is
what lets the bard re-charm you on the very shot that broke the last one.

**Berserk outranks Charmed.** Rage beats love, so a berserk player *will* go for the
singer. Its approach is greedy rather than pathfound, on purpose: rage is not clever,
and a berserk player who solves a maze to reach the far side of the room reads as
help. Walking into a wall still burns the turn.

All of it shows as chips under the vitals bars — stun, the five hexes, a burn, a
poison, and the two aura multipliers. Without that the crypt is a floor where your
steps silently cost double and your blows silently miss, which is indistinguishable
from a broken game.

### The crypt's floors: long halls, big chambers, sarcophagi

`layout` is now a per-biome block, and every default in it is exactly what the
generator did before the block existed — a biome that authors nothing generates the
floors it always did. The crypt authors `6,13,120,0,14,55`:

| | forest (default) | crypt |
|---|---|---|
| room side band | 4–9 | 6–13 |
| area cap | 60 | 120 |
| attached rooms | 30% | **0%** — every room is down a hall |
| longest straight hall run | 6 | **14** |
| average room area | 33 | **77** |
| rooms per floor | ~9 | ~4 |

**Sarcophagi are not a new tile.** A sarcophagus is one of the obstacle pillars
`placeTrees` already drops in big rooms — already solid, already sight-blocking,
already correct in every predicate CLAUDE.md rule 5 lists — and `sarcophagusPct`
only decides how many of them are *painted* as stone coffins. A new `TILE` row would
have bought the same look for the price of auditing `passable` / `isWall` /
`blocksSight` / `floodReach` / `fixOpenCorners` and the travel pathing. That is the
exact trade the rule warns about, and the answer was to not take it.

Two changes to `placeTrees` came with the bigger rooms, and the first is a real bug
fix: **every pillar is now reverted if it would strand a room.** That pass has never
had a reachability check, and it is the pass that used to entomb bosses on boss
floors. It costs one flood fill per pillar and buys back a whole class of unwinnable
floor — which matters far more now that a room can be big enough to want a dozen.
Second, the pillar count is capped at 12: the uncapped `1 + (area−21)/5` turns a
12×10 crypt hall into twenty obstacles, which is a maze rather than texture.

### Sprites

DCSS has no tile for a red slime, a black slime, a hollow acolyte, a brute or a
hollow bard, so these five are drawn for Cantori and released public-domain
alongside the CC0 art (see `ART-CREDITS.md`). They are plain, composed from simple
shapes at 32×32, and exist so that no data row renders as a bare glyph. Any of them
can be replaced by dropping a better PNG over the same filename — nothing in the
code needs to know.

## Four ways the item card lied — DONE

Reported as "two Flaming on the same bow". It was that, and pulling on it found
three more in the same few lines.

**Duplicate affixes.** `rollItem` drew both stats and enchants with replacement, so
any roll that took two of a kind could take the same one twice. Weapons have only
**three** eligible enchants and trinkets **two**, so this was not rare: measured over
81,000 rolls, **29% of every item that rolled two enchants got a duplicate.**

And it was not cosmetic in either direction:

- `procEnchants` walks the array, so two Flamings each roll their own proc and both
  can fire — a straight double-dip on damage.
- `gStatBonus` adds `val + triangular(plus)` per matching entry, so two of the same
  stat count the upgrade bonus twice. On a +3 item that is six points more than the
  two distinct affixes it replaced.

So the duplicate was quietly the *stronger* roll while reading to the player as a
bug. Both pools are now drawn without replacement. If a category has fewer distinct
enchants than the rarity asks for, the extra becomes a stat, so the item still
carries as many properties as its rarity promises rather than silently rolling one
fewer.

**The card under-reported every upgraded item.** `itemAffixText` printed
`val + plus` where `gStatBonus` computes `val + triangular(plus)`. They agree at +0
and +1 and diverge from +2 on: a tier-1 stat affix at +4 was displayed as +5 and was
really **+11**.

**The card never showed a weapon's to-hit.** It read `g.accuracy`, a field the d20
migration removed — no gear row has carried it since. So the dagger's +3, the bow's
−3 and the axe's −5 were all invisible, which on the bow in the bug report is
arguably the most important number on the item.

**The editor's proc formula was pre-D&D.** It published `eff(LCK) / 100`; the engine
does `max(0, mod(LCK)) × 3%`. At LCK 10 the reference promised +10% and the truth was
+0%.

Three new reference rows go with the fixes — the triangular stat-affix formula, the
affix-per-rarity table with its no-duplicates rule, and how many enchants each
category actually has eligible — because the last one is the tripwire: a category
with a small enchant pool is what turns a rich roll into a duplicate, or now into a
substituted stat. `itemText()` joins the dev surface so the card can be diffed
against the engine from a test rather than by eye.

## Floors the shape of Shattered Pixel Dungeon's — DONE

The complaint was that floors felt too big and monsters too spread out. Measured
against SPD's source, Cantori was not actually sparser — ~330 walkable tiles with 8
monsters is one per 40, against SPD's one per ~60. What differed was structure.

**Floors are now more rooms, smaller.** An SPD standard room is `SizeCategory.NORMAL`,
outer dim 4–10, and `Painter.fill` insets 1 — so its interior is 2×2 to 8×8, about 25
tiles, and a Caves floor (its depth 11–15) carries ~10 of them. Cantori was running 8
rooms of ~38. Same total floor, fewer and larger spaces.

| | before | after | SPD |
|---|---|---|---|
| rooms per floor | 8 | **9.5** | ~10 |
| average room | 38 | **30** | ~25 |
| walkable tiles | 330 | **300** | ~300 |
| rooms sharing a wall | 30% cap | **60%** | most of the floor |
| used extent | 38×37 | **36×36** | sized to fit |

The count of *rooms* is what a floor feels like, because each one is an encounter: the
same floor divided into half as many rooms plays as half as much game. Two knobs moved
into the per-biome `layout` block to get there — `roomTarget` (total room floor to lay
down, so `roomTarget ÷ mean room size` **is** the room count) and `attachCap` (ceiling
on shared-wall rooms). Raising the attach rate is what turns a scatter of chambers on
the ends of hallways into SPD's warren.

The crypt keeps its own big-chamber layout and gets an explicit `roomTarget: 290` so
the smaller global budget does not quietly shrink it from four rooms to three. It is
the one biome still undesigned.

**Monsters arrive in pairs, and keep arriving.** Two changes, both SPD's:

- 25% of placements put a second monster in the *same room* (`Random.Int(4)` in SPD's
  `createMobs`). Scattering N monsters one per room gives N thin moments; letting a
  quarter double up gives fewer moments, but some of them are a pair — and a pair is a
  fight where a lone sleeper is a chore. It lands at ~45% of occupied rooms holding
  two or more.
- **Every biome respawns now**, one monster per 50 turns up to a cap (SPD's
  `TIME_TO_RESPAWN`). Only the forest had a respawn at all; caves, crypt, town and lake
  cleared out and stayed cleared, so with a 1000-turn floor clock the back half of a
  visit was played on an empty map. Caps run 8/10/10/11/12 by biome.

**Sight is 6 tiles, for both sides.** It was 8, which is a whole ordinary room. `SENSE`
— how far a monster notices you — is now defined *as* `FOV_RADIUS` rather than as its
own number, because the ambush only works while neither side sees further than the
other: leaving monsters at 8 against a player at 6 would open every fight with
something already awake, walking out of a dark you cannot see into. The respawn
distance is tied to the same constant for the same reason.

Measured effect of the sight cut: tiles visible from a standing position 47.7 → 42.6,
and the share of positions with no monster in sight 57% → 65%.

**One honest caveat.** The stated goal was to stop seeing a whole room on entering it,
and 6 tiles does not achieve that on its own, because the rooms shrank in the same
change. Standing in a room's mouth you still see a median 81% of it (it was 83%). You
see *fewer tiles* — 24 rather than 32 — but a similar fraction of the room. At ~30-tile
rooms, a 6-tile radius covers the room; that goal needs either rooms kept larger than
sight or sight cut below 6, and the two pull against each other.

## The bear that could not path — DONE

Reported from a screenshot: a bear stood on the far shore of a pond, in plain sight
of the player, and never moved. Reproduced headless — the bear sat on **one tile for
thirty turns** while a wolf spawned on the same tile routed around the water and
arrived adjacent.

It was two bugs stacked, and the first hid the second.

**A charge gate that confused seeing with running.** The gate read:

```
m.charge && d >= 2 && d <= CHARGE_MAX && straightDir(m) && lineOfSight(…)
```

Deep water is transparent and impassable — `opaque` and `solid` are different rows in
the `TILE` table, which is the whole point of that table. So the bear had a clear line
across the pond, took the charge branch, and `doCharge` stopped dead on the first water
tile with `moved = 0`. Turn spent, nothing done, every turn, for ever. It never reached
the approach code at all.

The gate now also asks `chargeLane()`, which walks the tiles the dash would cross and
checks each one is steppable. Sight and movement are separate questions — the same
split CLAUDE.md rule 5 draws between `blocksSight()` and `passable()`.

**An approach with no pathfinding.** `chargeApproach` scored every neighbour by
`−distance` and took the best, which is a plain greedy step with no idea what is
*reachable*. Fixing the gate alone would have turned the freeze into a shuffle: the
bear would have paced the shoreline instead of standing on it. Its `else
stepMonsterTo(…)` fallback was dead code, because a legal neighbour almost always
exists.

This is the same local-minimum trap that `stepMonsterTo` and the wandering AI were each
fixed for long ago — both of them BFS now, and both carry comments about it.
`chargeApproach` was written separately and got neither fix, which made the bear the
only monster in the game that could not path around an obstacle.

It now sidesteps **only when the sidestep actually buys a lane it can run**, and
otherwise approaches through `stepMonsterTo` like everything else. Measured after:

| | before | after |
|---|---|---|
| bear across a pond, 30 turns | 1 tile, never crossed | 12 tiles, reached the player — the wolf's exact route |
| open ground, lined up at 5 tiles | charges | charges, 12/12, 4 tiles crossed |
| a wall mid-lane | (would have paced) | steps around it, ends adjacent |

A `setTile` dev hook came with it, so terrain-versus-pathing bugs can be reproduced in a
test instead of from a screenshot.

## Four small things, and a fourth bug found under one of them — DONE

**The item card shows what an enchant is worth.** `✦ Defense` alone told you nothing:
a tier-1 Defense is +1 and a tier-5 is +8, and the card looked identical either way.
It now prints the tiered value, with the sign saying which kind of number it is —
Defense is flat mitigation added to every block, everything else multiplies something.

```
Rusted mail (tier 1)     ✦ Defense +1
Banded plate (tier 3)    ✦ Defense +3
Adamant bulwark (tier 5) ✦ Defense +8
Sword                    🔥 Flaming ×0.5
Short Bow                ✦ Speed   ×1.1
```

Adding that display could not be done honestly, because **three enchants never read
their own `tierValues`**. Only Defense, Speed/Swiftness and Poison went through
`enchantTierValue`; Burn, Shock and Thorns read `fx.burstMult` / `fx.mult` directly,
so their five-number arrays were dead data and a tier-5 Flaming weapon burst for
exactly the same as a tier-1. They honour the arrays now. That is a real power
increase at the top tiers — the intent was clearly authored, and the editor has
always documented it as working, but the arrays may want retuning.

**No scattered loot on a boss floor.** The fight is the floor; gold and gear round
the edges only pull you off it, and the boss already pays out properly on death.
Measured: boss floors now show 0 gold and 0 gear against 2–3.7 gear on a normal
floor. The two GUARANTEED drops still land — the per-floor Potion of Insight and the
per-biome Scroll of Upgrade are the economy rather than clutter, and because the two
scroll floors are picked across all five, skipping boss floors would silently cost a
biome a scroll whenever it happened to pick the fifth.

**Scrolls already stacked; you just couldn't see which were alike.** Same-key
consumables have shared a slot since the beginning. The real problem was that every
unidentified scroll read "Unidentified Scroll" and drew the same parchment in the
same colour, so a Scroll of Mapping and a Scroll of Teleportation sat in the pack as
two slots you could not tell apart — which looks exactly like identical scrolls
refusing to stack. Potions have been dealt a scrambled shade + colour per run since
they existed; scrolls never got the equivalent. They now draw a rune title and a
wax-seal colour, so `Scroll titled "Eihwaz"` and `Scroll titled "Kenaz"` are visibly
different objects, and two that match really are the same scroll.

**Weapons and armour have sprites.** `renderIconInto` has always looked up
`SPRITES[key]` — but `SPRITE_NAMES` never contained a single gear key. Only `dagger`
and `sword` resolved, by accident of being in the hardcoded list; **24 of 26 gear
rows** fell through to the vector primitives, which is why every axe, spear, bow and
all fifteen armours drew as the same generic blade or shield. Twenty new 32×32 tiles,
public domain, plus the loader actually asking for gear keys.

Each armour family shares one silhouette — a hooded robe for light, a sleeveless
jerkin for medium, a pauldroned breastplate for heavy — and tiers differ by palette
and surface (quilting, studs, scales, mail, bands, a heraldic crest). A tier should
read as the same kit made better, not as a different object. Jewelry is deliberately
still drawn by `drawJewelInto`, which tints a ring or pendant with the item's own
rarity colour; a fixed sprite cannot do that.

`mace.png`, `leather.png`, `chain.png` and `plate.png` are now orphans — no gear row
has ever used those keys. Left in place; harmless, and a future weapon may want them.

## Warrior tree finished, Evasion made its own thing, the floor's clock halved

**Sword Master is a to-hit skill that turns into a damage skill.** To-hit early,
because that is what a level-1 warrior actually lacks; damage late, gated behind
character level:

| rank | gives | gate |
|---|---|---|
| 1 | +1 to hit | — |
| 2 | +2 to hit | — |
| 3 | +2 to hit, +1 max damage | level 7 |
| 4 | +3 to hit, +1 min and max damage, and a blue sword | level 10 |

Measured on a white sword: to-hit 12 → 13 → 14 → 14 → 15, damage 12–20 → 12–21 at
rank 3 → 13–21 at rank 4.

Two bits of engine came with it. `minLevel` now works **per rank**, not just per
node, which is how a skill can be available from the start and still hold its best
ranks back. And a rank may carry `grantGear` — a spec, not a hardcoded key, so the
reward tracks whatever the gear tables hold.

**Smite no longer needs a maxed branch behind it.** Its `reqAny` (Rush, Spin or Sword
Master at rank 4) is gone; the tier gate alone stands. *Spinning* Smite still wants
Smite and Spin both maxed — that requirement names Smite but is not Smite's own.

**The four authored-but-never-wired warrior skills work.** Raging, Healing and
Spinning Smite, and Lay on Hands, all had descriptions and level notes but no `ranks`
array — and `normalizeTree` skips a node without one, so they were invisible in the
tree rather than broken. Now:

Every Smite variant lands the **same core blow** — `round(mod(STR) × 3 × the Smite
skill's own strMult)` — plus whatever it adds. That is why they sit behind Smite:
levelling Smite levels all of them, and none needs its own damage ladder. Raging adds
half your level and sends the target berserk (rank 3 also grants STR and VIT equal to
your level, spent a point every `level` turns; rank 4 pushes that decay back on every
kill). Healing returns what it dealt, and at rank 4 the overflow hardens into a
shield that eats damage before your HP does. Spinning hits everything in reach.

Lay on Hands heals VIT, then STR, then level — and its overflow comes off the
cooldown, one turn per point. Worth knowing: at level 32 that took a 200-turn
cooldown to 26. Casting at full health is a way of buying readiness with MP, which is
the trade as written, but the discount is steep.

**Evasion is no longer Armour Class.** AC is how hard you are to aim at; Evasion is
slipping a blow that was already aimed true, so it is rolled *after* the attack roll
beats your AC — 2% per point, capped at 50%. Measured at 25 points: 46% of connecting
blows slipped, against 50% expected.

That split is what makes **Ourn's Future Sight** a real choice. It used to give +1
accuracy **and** +1 evasion every 10 kills, both feeding the same d20 — which is how a
player reached **+27 to hit**, since 270 kills is an ordinary run. Now it is every
**25** kills and a coin: to-hit or Evasion, never both. Two currencies, one of them
capped.

**The floor's patience is 600 turns, and the first warning costs something.**

| turn | |
|---|---|
| 300 | *"The spark has left this location."* — a warning you can still act on |
| 450 | *"You feel yourself losing your way."* — **HP regeneration stops for the rest of the visit** |
| 550 | *"You must leave now, or you do not think you ever will."* |
| 600 | the Horror comes |

It was 1000 turns with one warning at 900 — long enough that most players never met
it, and a clock nobody meets is not a clock. MP regen is untouched: the floor is
tired of you, not hostile to magic, and taking both would end runs quietly. The TIME
bar turns at 300 and its tooltip says why.

## A floor you cannot finish, once in seven thousand — DONE

The smoke test caught a depth-18 floor whose stairs could not be reached on foot.
Swept 14,000 generated floors: it happens about **1 in 7,000**. Rare — but over a
25-floor run that is roughly a run in three hundred that simply cannot be finished,
and this game is permadeath.

Boss floors have had a backstop since the arenas landed. Ordinary floors never did,
and the terrain check that runs beside it cannot help: it only undoes **terrain**, so
`unpaintTerrain` repairs nothing that water did not cause. A doorway walled up by
`narrowRoomBreaches` or `fixOpenCorners` is beyond it — and likelier now that most
rooms attach by a single shared door rather than a corridor.

Ordinary floors now get the same treatment: if the exit is unreachable once
everything is placed, carve a corridor to it. Carving is always available where
removing terrain is not. Verified across those 14,000 floors — the backstop fired
twice and **not one floor ended unreachable**.

## STR is rolled into the swing, not added to it — DONE

`strBonus()` was a flat `mod(STR)`, so a high-STR character's damage was a
dependable number with the weapon's dice wobbling on top. Every swing now rolls
`randInt(floor(mod/2), mod)` — half the modifier to all of it.

The reasoning: this game gives you **one attack per turn**. D&D spreads a big
modifier over several attacks, which is where its variance comes from; without
multiattack that spread has to live inside the single swing instead.

Measured, white sword (2–6), crit-free:

| level | mod | before | after | spread |
|---|---|---|---|---|
| 1 | +2 | 4–8 | **3–8** | 4 → 5 |
| 10 | +5 | 7–11 | **4–11** | 4 → 7 |
| 25 | +8 | 10–14 | **6–14** | 4 → 8 |

The **ceiling never moves**. Only the floor drops, so your best hits are exactly
what they were and your worst are worse — variance bought without touching the top
end. Average falls about 8% at level 1 and 17% by level 25.

Negative modifiers are ordered through min/max so they read as "small penalty to
large" (at −3, that is −3…−2) rather than inverting into an empty range. The Atk
readout moves both ends, so the pack header shows the real spread instead of a fixed
band shifted sideways.

### A blow that healed the monster

Found while checking the negative case. The player's outgoing damage had **no floor**
— the incoming path has had `Math.max(1, …)` forever, the outgoing one never did. At
STR 4 with a weak weapon every blow landed on zero or below, and a negative would
have been *subtracted from* the target's HP loss, healing it.

Reachable, not theoretical: Ourn's Pride takes a point off every stat every 15 kills
"with no floor". Rolling STR lowers the bottom end, which is what brought it within
reach rather than leaving it a curiosity. Outgoing damage is now floored at 1 like
everything else, and the Atk readout clamps to match rather than promising a negative.

## Floors that are the size Shattered Pixel Dungeon's are — DONE

Cantori felt empty next to SPD and Shiren. The spawns were not the problem; the
floors were.

**First, a correction to an earlier measurement here.** A previous pass put SPD's
standard room interior at ~25 tiles. That was an estimate, and it was wrong.
`Room.setSize` does `resize(NormalIntRange(4, 10) − 1, …)` with the comment *"subtract
one because rooms are inclusive to their right and bottom sides"*, and `Painter.fill`
then insets a wall — so the interior is **(D − 3)², a mean of about 17**. Cantori's
rooms were 29. Nearly double, while the earlier note claimed near-parity.

**Second, and more useful: room size was never the whole story.** Shrinking rooms
alone just fits more of them into the same fixed 47×47 grid, with more corridor in
between. Measured across four candidate sizings, the used extent stayed at 36² and the
walk to the stairs did not move at all. SPD sizes its map *to* its rooms (bounding box
plus one tile of padding) and packs most of them wall-to-wall; Cantori scatters them
across a fixed grid with a 3-tile gap. So the packing knobs matter as much as the
sizes, and `roomPad` joined the layout block to make that tunable.

| | before | after | SPD |
|---|---|---|---|
| rooms per floor | 9.6 | **10.2** | 9–13 |
| average room | 29 | **19** | ~17 |
| walkable tiles | 309 | **212** | ~190–280 |
| used extent | 36² | **29²** | sized to the rooms |
| walkable tiles per monster | 44 | **30** | ~30 |
| steps from start to stairs | 30 | **24** | — |

Monster counts are untouched — 7 alive on a mid-game floor either way. The floor
shrank around them.

The crypt keeps its own big-chamber block and is pinned at `roomPad: 3` and
`attachCap: 70` so the new packing defaults do not quietly reshape the one biome that
is still undesigned.

**The exit backstop is now earning its keep.** Across the same 14,000-floor sweep it
fired **5 times** rather than 2 — tighter packing does strand more floors — and not
one ended unreachable.

## The skill card sits under the skill — DONE

The tiered skill selector put the detail card — description, requirements, "Now/Next",
and the button that actually spends the point — below *every* tier. Tapping a tier-1
node meant scrolling past four more tiers to find out what it does, by which point the
node you tapped was two screens off the top.

The card is now spliced in directly beneath the tier row that owns the selected node,
railed in amber down its left edge so it reads as belonging to that row. With nothing
selected the "tap a node above" prompt stays at the bottom, where it is a hint rather
than a card.

## Potion of Poison: a share of you, halving — DONE

It was a flat 4–8. That is a real decision on floor 1, a rounding error by floor 5 and
free by floor 15, which made "drink the unknown potion" a strictly correct play for
most of a run.

The dose is now a share of the drinker: **25–50% of max HP on the first tick, halved
(rounded down) every tick after, until 0.** The whole draught costs about twice the
opening tick — a 64 opener bleeds 64/32/16/8/4/2/1 for 127 total — and almost all of
it lands in the first two turns. That is the point. The answer to a bad potion should
be *act now* (heal, run, cure), not *walk it off*.

**Bosses cap at 10% of max HP.** A percentage of a 600-HP pool is not a status effect,
it is a kill button, and one bought potion should not be a boss fight.

Thrown, it does the same thing to whatever it bursts over — the monster tick grew a
`halve` mode so a draught reads the same whichever end of it you are on.

## Potion of Paralysis — DONE

Holds the subject for **depth..depth×2 turns**, with a **RES save every turn at DC
10 + depth/2**. Longer the deeper you are, because what it has to hold gets worse at
the same rate — but never a sentence, because the victim keeps flipping the coin. That
cuts both ways: throwing one is a gamble, and drinking one unidentified is survivable.

- **Bosses cap at 5 turns.** A bad RES roll could otherwise buy twelve free swings on
  the fight the whole floor is built around; that is not a consumable, that is a skip.
- **It breaks a telegraph.** A wound-up slam or aim line is cancelled outright. Letting
  one land out of a frozen body would read as broken at exactly the moment it matters.
- Monsters carry no RES score, so their level stands in for one (`floor(level/2)`) —
  the same assumption the fear roll already makes. A `res` field on the row wins if
  one ever lands.
- For the player the save is rolled when you *try* to act, so trying is what tests it;
  the clock runs on the world turn either way, so waiting it out still works.

## Poison and paralysis are rarer on the shelf than in the dungeon — DONE

Consumable rows gained an optional **`shopWeight`**, used by the merchant in place of
`weight`. Only the harmful draughts set it, and only downward: both sit at 1.5 against
a drop weight of 2.

A shelf is a choice the player pays for. A stall that offers poison as often as it
offers Strength is not selling three potions, it is selling one potion and two coin
flips. Floor loot keeps its odds — *finding* a bad potion is a discovery, *buying* one
is a mugging. Measured over 20,000 rolls the stall now stocks poison 11.5% of the time
against Strength's 15.6%.

## Rest is its own button — DONE (and the hold-to-wait it replaces was broken)

Waiting a wound off was sixty separate taps: not a decision the player is making, a
toll they are paying to make one. That first shipped as press-and-hold on the ⏳ slot,
**and it was broken in a way worth recording.**

`worldTurn()` calls `updateHotbar()`, which empties the hotbar and rebuilds every slot
from scratch. So a single tap on Wait ran its turn, and that turn *destroyed the
button the finger was still resting on*. The element was detached before its own
`pointerup` could fire, the cleanup that cancels the hold timer never ran, and 300ms
later the rest started by itself and ran until something interrupted it. One tap, and
the monsters took a hundred actions.

The lesson generalises: **nothing wired to a hotbar slot may outlive the turn it
spends**, because the slot does not. `makeSlot` is a plain button again.

Rest now has its own 🏕 button beside Character, Pack, Examine and Map — outside the
hotbar, so it cannot be destroyed by the turn it starts. One press starts it, the same
press stops it, and the `R` key does both too. Measured: one tap on Wait is exactly one
turn and starts nothing; five taps are five turns.

The loop stays deliberately twitchy, because a rest that runs *through* the thing it
should have noticed is far worse than the taps it saves. It stops on:

- a foe coming into view that was not in view before
- a single point of damage
- the floor speaking up — any `restBreak()` caller, which today is every Horror stage
  message and the Horror's arrival
- **any** input at all, captured on the `document` rather than on the game, so
  reaching for the inventory stops the clock before the inventory opens
- death, or any modal, throw or skill-targeting state opening

And it refuses to start at all with something already in sight, *out loud* — "You
cannot rest with something in sight." A button that does nothing and says nothing is
the bug this section is about.

Two inputs are exempt from the any-input stop: the Rest button itself and the `R` key.
Both already mean "stop resting", and without the exemption they would stop the rest
and then be re-read as a fresh "start resting" by the toggle a moment later.

## Brynn's tiers 2 and 3 — DONE

Brynn had two skills, both in tier 1, and nothing to spend a point on after level 5.
Four more, and between them they give her a reason to control distance rather than
close it.

### Dragon Kick (tier 2)

**Damage = (a normal attack roll − 1) × the squares crossed before the collision.**
The run-up *is* the skill. Kicked from six squares out it is worth roughly six blows;
kicked at something already touching you it lands at ordinary weight and says so in
the log, because silently dealing nothing reads as a broken button.

| squares travelled | 0 | 1 | 2 | 4 |
|---|---|---|---|---|
| median damage (attack 2–4) | 3 | 2 | 4 | 8 |

That is the opposite of what every other melee button asks for, which is the point:
it wants you to make space before you spend it.

- **Rank 2** does not start the cooldown on the first kick, so a second one is free.
  Measured: first kick spends 5 MP and arms the encore, the encore costs 0 and starts
  the 50-turn clock. Decline it and the clock starts on its own one turn later.
- **Rank 3** makes both free actions — verified at 0 turns spent for two kicks.
- **Rank 4** removes the reduction — the `− 1` — so every square is worth a whole
  attack instead of one short of it. Worth exactly one extra point per square, which
  measured out cleanly on a 2–3 attack:

| | 2 squares | 4 squares |
|---|---|---|
| rank 3 — `(attack − 1) × squares` | 2–4 (median 3) | 4–8 (median 8) |
| rank 4 — `attack × squares` | 4–6 (median 6) | 8–12 (median 8) |

  (Maxima run one or two above those bands on a crit, which multiplies the whole
  run-up rather than one square of it.) The whole band shifts up by the number of
  squares: at 4 squares rank 4's *floor* is rank 3's ceiling.

### Meditate (tier 2)

Sit still and mend fast; it ends the instant you stop sitting still. Measured over 20
turns from a wound, on a 116 HP character:

| | healed |
|---|---|
| no trance | 6 |
| rank 1 (×5) | 35 |
| rank 2 (×10) | 70 |

- **Rank 3** refunds 2 cooldown turns per point healed — 25 turns of ×10 regeneration
  took a 293-turn cooldown to 102, exactly as the arithmetic predicts.
- **Rank 4** leaves +3 damage, to-hit and AC for (level × 2) turns: AC 11→14, to-hit
  13→16, attack 2–4→5–7, for 40 turns at level 20, expiring cleanly.

It pairs with holding ⏳ deliberately — the skill is "spend real time", and holding
Wait is how you spend it.

**One bug found and fixed while measuring.** The trance watches your HP total rather
than patching every damage source, the same trick charmWatch uses. But at ×10
regeneration a small hit is *exactly cancelled* by the healing in the same turn, so
the net was zero and the watcher saw nothing — 4 damage landed and the trance held.
The high-water mark now climbs with the healing, so falling short of it means
something took HP off you even when regeneration hid it.

**And a deadline worth knowing at the table:** a floor whose spark has gone out (turn
300) regenerates nothing at all, meditation included. That is the anti-grind rule
working as designed, but it does mean the skill stops existing halfway through a
floor's patience.

### Happy Feet (tier 3)

Passive, and only while wearing cloth (light) or medium armour — footwork you cannot
do in plate. Measured at DEX 10 so nothing else moved:

| rank | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| AC | 12 | 14 | 14 | 14 |
| dodge | — | — | 5% | 10% |

In heavy armour: AC 10, dodge 0 — correctly off.

Two firsts came with it: the first passive that adds **AC** (`passiveMod("ac")` now
feeds `playerAC`), and the first that buys dodge as a flat **percentage** rather than
in 2%-per-point evasion points, so the card can say "+5%" and mean it. Both dodge
routes share the one 50% cap.

### Now You See Me (tier 3)

The Scroll of Invisibility's trick on a 100-turn cooldown: 5 / 10 / 20 turns, and
everything hunting you drops the trail. Striking still ends it early. Rank 4 pays you
for coming back: **+5 damage for 5 turns**, landing however the veil ended — walked
out or spent on a blow. Measured at rank 4: 5 MP, exactly 20 turns invisible, then
+5 damage on the attack readout for 5 turns.

## A dangling monster name stopped the game — FIXED

Not part of the above; found by the smoke test on the way in, and **live on `main`**.

`eligiblePool` read `VERMIN[k].minFloor` for every key in a biome's `monsters` list.
Town still names `jackal` and `hornet`, both of which have been deleted from the
monster table — so generating any Town floor threw an uncaught `TypeError` inside
`generateLevel`. Not "the floor spawns nothing": the game stops.

Deleting a monster row in the editor does not scrub that key out of every biome that
lists it, so a dangling name is a *normal* consequence of ordinary content editing and
must never be fatal. The filter now skips unknown keys.

Town is therefore down to one monster (`imp`) until either those two rows come back
or the names come out of the list — the guard makes it survivable, not good.

## The editor's skill-kind dropdown had drifted — FIXED

`KINDS` in `editor.js` listed five of the twenty-two kinds `useSkill` actually
dispatches. Its own comment warned what that costs: "a kind missing here gets
silently rewritten to `passive` the moment anyone touches the control" — which is
every mage skill, every boon active, and every Smite variant. The list is now
complete.

## Wearing nothing lets all of your DEX through — DONE

A DEX-17 Brynn with an empty armour slot read **AC 10**. That was the armour cap
being applied by a piece of armour that did not exist: `armorDexCap()` returned 0
whenever `player.armor` was null, which is the same answer it gives for plate.

Armour caps DEX because it is *in the way*. There is nothing in the way of a bare
body, so there is nothing to cap. Unarmoured is now uncapped:

| DEX | 10 | 14 | 17 | 20 | 24 |
|---|---|---|---|---|---|
| **nothing** | 10 | 12 | **13** | 15 | 17 |
| cloth (light) | 10 | 10 | 10 | 10 | 10 |
| padded jerkin (medium t1) | 10 | 11 | 11 | 11 | 11 |
| studded leather (medium t2) | 10 | 12 | 12 | 12 | 12 |

The trade stays real in both directions, because mitigation is entirely the item's
own `defMin`/`defMax` roll: naked you are the hardest thing in the game to hit and
you block **nothing at all**. Medium armour ties the naked number once `tier + plus`
reaches your DEX modifier and brings a damage block with it, so it overtakes rather
than merely catching up — and every upgrade scroll widens what your DEX is allowed
to do.

It also gives **Happy Feet** something to do that going naked cannot: the passive
only works in cloth or medium, so cloth at rank 2 is AC 14 against a bare 13, and
medium keeps its mitigation on top of that. Without this change a high-DEX monk had
no reason to wear cloth at all.

The screenshot case measured: DEX 17, nothing worn, **AC 10 → 13**, and the stats
screen agrees — "Armour Class 13 (~45% to be missed)" with the DEX cell reading
"to-hit +7 / AC 13".

## Magic Mapping revealed the bedrock instead of the layout — FIXED

The scroll fired, the log said the right thing, and the floor map came back as a
solid uniform block with the rooms showing as *holes* in it. It read as broken.

Two things compounded:

1. **It marked every tile explored, rock included.** A depth-4 forest floor is 2,209
   tiles, of which **2,000 are solid rock** — 90.5%. So "reveal everything" is
   overwhelmingly a command to draw rock.
2. **On the floor map an unvisited WALL is drawn brighter than a floor.** That is
   fine in normal play, where the only wall you have explored is the thin shell
   around corridors you actually walked. Reveal all of it and the relationship
   inverts: the screen fills with the bright colour and the rooms inside it are the
   dark parts.

A wall now earns its place on the map only by bounding something you could stand in,
so what floods in is rooms and corridors with outlines and the rock between them
stays dark:

| | before | after |
|---|---|---|
| tiles marked known | 2,209 (100%) | **418 (18.9%)** |
| of which wall | 2,000 | 209 — the outlines only |
| walkable tiles left off the map | 0 | **0** |

That last row is the constraint that matters: auto-travel paths only across explored
tiles, so every walkable tile still has to be marked or the scroll would strand it.

The map's floor colours were lifted too (`#151009` → `#241c11` merely-mapped,
`#221b12` → `#332a1c` walked). Both sat within a hair of the near-black map
background, which nothing noticed while every floor on screen was ringed by bright
explored wall — and which made room interiors indistinguishable from the void the
moment a magic map drew rooms nobody had walked into yet.

## The regeneration cut moves to the second stage — DONE

Losing every point of healing at turn 300 was too punishing. Half a floor's patience
is not long, and a floor you are still exploring can hand you an ordinary fight that
becomes a run-ender purely because nothing comes back afterwards.

The cut now rides on the **second** stage instead of the first:

| turn | |
|---|---|
| 300 | *"The spark has left this location."* — a warning, and the TIME bar turns |
| **450** | *"You feel yourself losing your way."* — **HP regeneration stops** |
| 550 | *"You must leave now, or you do not think you ever will."* |
| 600 | the Horror comes |

So the first stage is now something you can act on and the price lands with 150 turns
left to leave on. Measured over 40 turns from a wound, walking the counter through
each stage: **8 HP healed before 300, 8 after 300, 0 after 450.**

One thing worth recording for anyone testing this: a stage fires on `turns === st.at`
exactly, so a test that *sets* the turn counter past a stage skips its trigger
entirely and reads as though the stage never happened. Walk the counter through.

## The Piper: two turns of warning, and bats instead of snakes — DONE

**The death line now sits for two of the Piper's turns before the rat launches**, with
its own pulse and its own log line on the second (`"The line still burns — it comes
next turn!"`). A telegraph the player cannot tell is still live is not a telegraph,
it is a stale red rectangle.

One turn of warning is only enough if you were already free to move. A step out of
the lane that walks you into a rat, or a turn you needed for a potion, and the 30
damage lands anyway — which makes it a reaction test rather than a decision. Two
turns means one of them can be spent on something else. Measured over three casts:
the line is up for exactly 2 boss turns every time.

**Its summons are rats and bats now, not rats and snakes** — 2 rats + 1 bat on the
entrance, 3 rats + 2 bats on the phase shift. Verified: zero snakes.

Worth noting this is a small *easing* on its own terms: a snake is AC 22 / 8 HP /
1–6 damage against a bat's AC 21 / 5 HP / 1–4. The bat is easier to kill and hits
softer, though both sit at the very top of the AC table.

One consequence to watch: the beam's miss branch spills **two more rats** when the
rat bursts on the wall. With two turns of warning the player dodges far more often,
so that branch goes from occasional to near-guaranteed — roughly 2 rats every 12
turns. Dodging correctly should probably not be the thing that buries you in adds.

## Measured: the first boss fight is not winnable by trading blows

A warrior arrives at the Piper at **level 5, 40 max HP, attack 2–5**, wearing the
starting `Shitty_sword` and `rusted_mail` — AC 10, to-hit +6. The Piper has **150 HP,
AC 14**, hits for 2–10, and a 30-damage line every 12 turns.

Driving the fight straight — stand adjacent, swing every turn:

| level | max HP | your damage/turn | its damage/turn | turns to kill it | turns to kill you | outcome |
|---|---|---|---|---|---|---|
| 4 | 35 | 3.0 | 2.9 | 50 | 12 | **died** |
| 5 | 40 | 2.1 | 2.2 | 71 | 18 | **died** |
| 6 | 46 | 1.7 | 3.3 | 88 | 14 | **died** |
| 8 | 56 | 3.4 | 2.9 | 45 | 19 | **died** |

**You need 45–88 turns to kill it. It needs 12–19 to kill you.** That is a 3–5×
deficit, and it does not close by levelling — a level-8 character dies as reliably
as a level-4 one, because HP grows about as fast as the gap does.

The beam is not even the problem: those runs recorded **zero beam hits**. The deaths
are ordinary melee plus three summoned adds. The spike is arithmetic, not tactics —
150 HP against 2–3 damage a turn is fifty-plus turns of exposure to a thing that
kills you in fifteen.

## The three armours get their identities straight — DONE

**Medium is the DEX-build armour.** Its DEX cap was `tier + plus`, which meant a
tier-1 piece held a nimble character to +1 — a tax on the exact build it is supposed
to serve. It is now **`2 + tier + plus`**, so a tier-1 piece already carries +3 and
each tier and each upgrade scroll adds another:

| armour | tier | plus | cap | AC at DEX 10 / 14 / 18 / 22 / 26 / 30 |
|---|---|---|---|---|
| padded jerkin | 1 | 0 | **+3** | 10 / 12 / 13 / 13 / 13 / 13 |
| padded jerkin | 1 | 2 | +5 | 10 / 12 / 14 / 15 / 15 / 15 |
| studded leather | 2 | 0 | +4 | 10 / 12 / 14 / 14 / 14 / 14 |
| studded leather | 2 | 2 | +6 | 10 / 12 / 14 / 16 / 16 / 16 |
| scale hauberk | 3 | 0 | +5 | 10 / 12 / 14 / 15 / 15 / 15 |
| scale hauberk | 3 | 2 | +7 | 10 / 12 / 14 / 16 / 17 / 17 |

It soaks a little and mostly makes you hard to hit, which is the point.

**Heavy cannot dodge.** `dodgeChance()` is zero while heavy armour is worn, whatever
Evasion you own. Plate answers a blow by absorbing it — that is what its mitigation
range is for — and "no AC, no DEX, no dodge, biggest soak in the game" is a clean
identity where "no AC and no DEX" alone was just a smaller version of medium.

The points are **suppressed, not spent**: take the plate off and every one of them is
still there. That matters because Ourn's Foresight coin and Happy Feet are chosen
long before you know what armour you will find, and a build-defining choice should
never become a trap.

Measured at DEX 18 with Happy Feet maxed: dodge **40% in medium, 40% in light, 30%
bare** (Happy Feet needs cloth or medium), and **0% in heavy**.

**Light is unchanged and already what it should be** — a caster's stat stick, granting
INT and MP outright (grass armour +1 INT / +5 MP up to threads of fate at +5 / +23),
thin mitigation, no AC.

## Correcting the first-boss measurement

The earlier table in this file measured a level-5 character **still wearing the
starting kit** — `Shitty_sword`, `rusted_mail` — which nobody actually reaches the
Piper in. The harness rolled five floors of drops and then failed to equip any of
them: `peek().inv` is an array of key *strings*, and the chooser was comparing
`inv[i].key`, so it matched nothing and silently kept the starting gear.

Re-measured with the floor's own drops equipped, a warrior arrives with something
like a blue or green Axe and takes:

| weapon | armour | attack | AC | to-hit | your dmg/turn | its dmg/turn | turns to kill it | turns to kill you |
|---|---|---|---|---|---|---|---|---|
| Axe blue | grass armour | 1–15 | 10 | +2 | 4.2 | 3.4 | 36 | 12 |
| Axe blue | rusted mail +1 | 1–15 | 10 | +2 | 3.6 | 2.9 | 41 | 14 |
| Axe green | padded jerkin +1 | 2–17 | 11 | +2 | 5.4 | 1.9 | 28 | 21 |
| Axe +1 green | padded jerkin +1 | 1–17 | 11 | +2 | 6.0 | 3.7 | 25 | 11 |

So the real figure is **25–41 turns to kill it against 11–21 to kill you**, not the
45–88 the first pass claimed. The fight is roughly **twice** as long as it should be
rather than five times, and the gap now swings hard on the weapon roll — which is the
more interesting finding, and one the broken harness hid completely.

## The armour triangle, settled — DONE

Three answers to "how do I not die", and each one now gives up something real:

| | DEX → AC | dodge | mitigation | pays you in |
|---|---|---|---|---|
| **nothing** | all of it | yes | none | — |
| **light** | **all of it, uncapped** | yes | thin | INT and MP |
| **medium** | 2 + tier + plus | yes | moderate | being hard to hit |
| **heavy** | **none** | **yes** | largest in the game | absorbing the blow |

Measured at DEX 10 / 14 / 18 / 24 / 30:

| armour | | |
|---|---|---|
| nothing | 10 / 12 / 14 / 17 / 20 | |
| grass, cloth (light) | 10 / 12 / 14 / 17 / 20 | same as bare, plus INT/MP |
| padded jerkin (medium t1) | 10 / 12 / 13 / 13 / 13 | capped at +3 |
| studded leather (medium t2 +2) | 10 / 12 / 14 / 16 / 16 | capped at +6 |
| chainmail (heavy) | 10 / 10 / 10 / 10 / 10 | no AC at all |

**Light lets the whole DEX modifier through**, uncapped, the same as bare skin. A robe
is not in the way of anything, and a caster forced to choose between mana and not
being hit is only ever choosing mana — light is a stat stick that no longer taxes you
for wearing it.

**Heavy keeps its Evasion.** An earlier pass had plate suppress the dodge as well as
the AC; that is two prices for one trade, and it punishes a build that committed to
Ourn's coin long before it knew what armour it would find. Giving up AC entirely is
the price. Verified with 15 evasion points: **30% dodge bare, in light, in medium and
in heavy alike.** (Happy Feet's share still needs cloth or medium — that is the
passive's own condition, not the armour gating evasion.)

## Maelon's Grace is back — DONE

**"Regain 2 + (character level / 5) HP on every kill."** 21st boon, under Maelon, and
counted in `MAELON_KEYS` so it scales Leper Colony like its siblings.

It existed once as a placeholder keyed by the god's own name (`maelon`), with its
whole effect living in `killMonster` rather than in `data.js`, and the 20-boon rewrite
(`3b14855`, "5 named boons per god, replacing the placeholder") dropped it on the
floor. Three other placeholders went with it — Kethara's Gift (a free purple armour),
Ourn Blinks (5 frozen turns on each new floor), Blessing of the Guild (+1% proc
chance per level) — none of which came back either.

That shape is also why an audit here briefly concluded the game had **never** had a
healing boon: it diffed the boon *keys* in `data.js` across every commit and found 20
identical keys throughout. A boon whose key was a god's name and whose effect lived in
`game.js` is invisible to that check. The claim was stronger than the evidence
supporting it.

Measured: **4.2 HP a kill at level 10** (expected 4), **6.5 at level 20** (expected 6)
— the overshoot is the ordinary kill-counter boons firing alongside it — and it never
heals past full.

## Rhythm of the Universe — DONE

Ourn's replacement for the deleted Ourn Blinks. **Cooldowns fall by 1 a turn, plus 1
more for every skill currently waiting** — and the bonus applies to all of them.

| skills on cooldown | 1 | 2 | 3 | 5 | 6 |
|---|---|---|---|---|---|
| points drained per turn | 2 | 3 | 4 | 6 | 7 |

The count is taken **before** anything ticks, so a skill coming off cooldown partway
through the loop cannot slow the rest of it down, and every skill moves at the same
rate that turn. Verified: without the boon it is a flat 1 whatever the count.

It snowballs deliberately. The more you have spent, the faster it all comes back — so
it pays a caster who commits to a rotation rather than one who hoards a single button,
which is the opposite of how cooldowns usually punish you.

Note on the spec: the brief said "6 skills on cooldown, each reduces by 6". Under
"+1 per skill on cooldown" six waiting is **7** a turn, which is what the worked
example of "2 on cooldown → 3 a turn" implies. The rule is implemented; the 6 → 6
figure looks like a slip in the example rather than a second rule.

## The gear tables, as CSV

`docs/gear.csv` — every gear row the game has, with the values the current formulas
produce at +0 through +5 so the ladder can be read rather than derived:

- weapon `dmgMin + (tier − 1) × plus`, `dmgMax + tier × 2 × plus`
- armour `defMin + floor((plus + 1) / 2)`, `defMax` capped at double the base

**One flaw that falls straight out of writing it down: a tier-1 weapon gains no damage
floor from upgrades at all.** `(tier − 1) × plus` is zero at tier 1, so a +5 sword is
2–16 — the ceiling nearly triples and the floor never moves, which makes upgrading an
early weapon a swingier gamble rather than a better weapon. Every starting weapon in
the game is tier 1.

`docs/gear-proposed-weapons.csv` holds a proposed 5-tier ladder for four subtypes —
20 weapons, mirroring the armour tables' shape — with a `current_+N` column showing
what today's formula does to each and a blank `WANT_+N` column to fill in instead.

## The gear ladder, from your spreadsheet — DONE

**One rule now governs every upgradeable number in the game:**

> **max = base_max + (tier × plus). The floor never moves.**

Weapons and armour both. It replaces two different formulas that disagreed with each
other and with the tables they served — the old weapon rule gave tier-1 weapons *no*
floor growth while doubling their ceiling (so upgrading a starting weapon bought
variance, not power), and the old armour rule clamped the ceiling at double the base,
which would have held a tier-5 plate to 68 when the authored ladder wants 60 at +5.
The clamp is gone.

### Weapons — 20 across four subtypes, five tiers each

| | t1 | t2 | t3 | t4 | t5 |
|---|---|---|---|---|---|
| **dagger** | Dagger 1–4 | Dirk 2–6 | Stiletto 3–9 | Fang of the Hollow 4–13 | Toothpick 6–20 |
| **sword** | Sword 2–6 | Broadsword 3–9 | Falchion 5–13 | Runed Blade 7–18 | Kingsmourn 10–25 |
| **axe** | Hatchet 3–8 | Axe 4–12 | Great Axe 6–17 | Headsman's 9–23 | Worldcleaver 12–32 |
| **bow** | Shortbow 2–5 | Hunting Bow 3–8 | Recurve 4–11 | Longbow 6–15 | Stormcaller 8–21 |

Verified in the engine: a tier-1 sword steps 1 a plus (2–6 → 2–11 at +5), a tier-5
Kingsmourn steps 5 (10–25 → **10–50**), Worldcleaver 12–32 → **12–57**.

**Axes speed UP with tier** (0.8 → 1.0), because slowness hurts more the deeper you
get. **Daggers are flat 1.0 and deliberately the weakest line** — stat sticks for
ToneTum, junk for everyone else. **Bows hold range 5 at every tier.**

Toothpick's base max is **20**, not the 18 in the sheet: the sheet's own +1…+5 series
(25/30/35/40/45) steps by 5 from a base of 20, and 18 was the only figure in the file
that did not fit its own rule. Banded plate's alternating `6-18 / 5-16 / 6-19` row was
a drag-fill and is now the clean 5-15 → 5-30.

### Armour — flat AC and an authored DEX ceiling

`armorAC()` returned 0 for everything; armour now carries a **flat AC** of its own,
and each row authors its own **`dexCap`** — how much of your DEX modifier reaches your
AC — which every upgrade widens by one.

| | flat AC t1→t5 | dexCap t1→t5 |
|---|---|---|
| light | +0 +1 +2 +3 +4 | 10 (uncapped in practice) |
| medium | +2 +3 +4 +5 +6 | 3 / 6 / 9 / 12 / 15 |
| heavy | +0 +0 +1 +1 +2 | 0 / 0 / 0 / 1 / 2 |

Measured AC at DEX 10 / 16 / 20 / 26 / 34:

| armour | | |
|---|---|---|
| grass armor (light t1) | 10 / 13 / 15 / 18 / 20 | |
| threads of fate (light t5) | 14 / 17 / 19 / 22 / 24 | |
| padded jerkin (medium t1) | 12 / 15 / 15 / 15 / 15 | plateaus at its cap of 3 |
| windwoven coat (medium t5) | 16 / 19 / 21 / 24 / 28 | |
| rusted mail (heavy t1) | 10 / 10 / 10 / 10 / 10 | |

**A `dexCap` of 0 means none, and upgrades do not open it.** Without that exception a
+5 rusted mail would quietly let 5 DEX through and heavy would stop being the armour
that gives up AC. Rows authored above zero (knight's plate 1, adamant bulwark 2) still
widen by one per upgrade like everything else.

### Sprites

Eighteen new weapon sprites, each its subtype's silhouette recoloured to the tier's
palette — the same trick the armour families already use, so a line reads as one kit
made better rather than five unrelated objects.

`docs/gear.csv` is regenerated from the shipped tables and now carries the AC and
dexCap columns too.

## The hatchet is no longer a trap — DONE

Tier-1 axe to-hit **−4 → −2**. At −4 a level-5 warrior swung at to-hit 0 against the
Piper's AC 14 — a 30% hit rate that meant the axe line's whole selling point, big
damage, simply never arrived. It measured as the worst weapon in the game while
reading on paper as the strongest.

At level 5 against AC 14:

| weapon | to-hit | damage | hit rate | ~damage per swing |
|---|---|---|---|---|
| **hatchet** | **+2** | 3–8 | **45%** | **3.8** |
| axe (t2) | +1 | 4–12 | 40% | 4.4 |
| great axe (t3) | +1 | 6–17 | 40% | 5.8 |
| sword | +6 | 2–6 | 65% | 4.6 |
| dagger | +7 | 1–4 | 70% | 3.9 |
| shortbow | +3 | 2–5 | 50% | 3.3 |

Fewer, bigger hits against the sword's steady ones — a real choice rather than a
mistake. The axe stays the slowest line (speed 0.8 at tier 1), so its damage per
*turn* still trails; that is the trade, not the trap.

**A shape worth knowing about:** the axe line's to-hit now runs −2, −3, −3, −2, −2, so
the tier-1 hatchet aims better than the tier-2 Axe and tier-3 Great Axe above it. That
is defensible — a hatchet is small and handy where the middle of the line is
deliberately clumsy, and the bigger weapons pay for their accuracy with damage — but
it is a deliberate non-monotonicity rather than an oversight, and smoothing the middle
to −2 across the line is a one-cell change if it reads badly in play.

The real mitigating factor is still to come: an axe skill for Chadwick, or a barbarian
who carries the line properly.

## ToneTum's openers — DONE

The mage was too weak to start with. Both of his level-1 spells were the reason.

### Magic Missile no longer asks you to aim

It picks the **nearest thing you can see** and fires. The volley widens with
character level, each extra bolt taking the next-nearest visible foe:

| character level | 1 | 3 | 7 | 12 | 18 |
|---|---|---|---|---|---|
| bolts | 1 | 2 | 3 | 4 | 4 |
| per bolt | 1–4 +level | | | | **2–8 +level** |

Verified: the thresholds land exactly at 3 / 7 / 12 (level 2 still fires one, level
6 two, level 11 three), and the die changes at 18 and not 17 — sampled 40 casts either
side, 1–4 at 17 and 2–8 at 18. A level-12 mage into four foes logged
*"4 bolts of force fan out. (-60 across 4 foes)"*.

**One bolt per body, never two on the same one.** It reads as a spray that finds what
is closest, and stacking the whole volley on a single target would make it a 4× nuke
at level 12 rather than a crowd answer. 5 MP buys the whole volley however many bolts
it throws.

### Burning Sensation opens at twice the INT modifier

`mod(INT)` → `mod(INT) × 2`. Measured opening ticks: **+1 → 2, +3 → 6, +4 → 8,
+5 → 10.**

**This more than doubles the spell**, and that is worth stating plainly: the burn's
*duration* has always been its opening tick, so the total is triangular in it. At INT
modifier +4 it is now 8 a turn for 8 turns — **36 total against the old 10**. A 20-turn
cooldown was never worth 10 damage; it is worth 36.

A note for anyone measuring it: the cast spends a world turn, and the burn is a
`decay` DOT, so the first value you can read is always one lower than the opening
tick. An 8 reads as 7 on the very next inspection. That is the same "first seen at
n−1" effect Burning Sensation has always had, not a rounding bug.

## Magic Missile spreads, then wraps — DONE

Confirmed and fixed: extra bolts now land on the only visible target. They spread
across distinct foes first and wrap around when they run out, so **three foes and
four bolts is 2/1/1, and one foe and four bolts is all four on it.**

Measured at level 12: **58 damage into a single rat** (four bolts, ~14.5 each) and
40 across three. A volley that fizzled to one bolt in a duel would have made the
spell worse the moment a fight got serious — good against a crowd and good against
one thing was the whole ask.

It re-reads the living between bolts, so a target that dies mid-volley does not eat
the rest of the volley.

## Burning Sensation burns for three turns — DONE

Duration is a flat 3 (plus a rank's `turnBonus`) rather than "as many turns as the
opening tick". Tying the two together made the spell quadratic in INT; a fixed window
keeps it linear and readable.

| INT modifier | opening tick | total |
|---|---|---|
| +3 | 6 | 6 + 5 + 4 = **15** |
| +4 | 8 | 8 + 7 + 6 = **21** |

Both measured. Every point of INT modifier is now worth exactly three more damage.

## Keen Intellect — ToneTum, tier 1 — DONE

Passive. Mana equal to a multiple of the INT modifier, on top of the base mana every
character already gets from INT: **×1, ×2, ×4 (level 6), ×5 (level 10)**, the top rank
also handing over a robe of tier 3 or better in green–purple.

Measured at an INT modifier of +8: max MP **77 → 85 → 93 → 109 → 117**, gains of
8 / 8 / 16 / 8 against an expected 8 / 8 / 16 / 8, total **+40 = 8 × 5**. Rank 4
delivered a `refined_robe`.

`grantGear` now accepts a **list** of rarities, because "green to purple" is a band
rather than one colour and that belongs in the data.

**One real bug fixed to make this work.** `learnSkill` never recomputed `maxHp` /
`maxMp`, and both are stored rather than derived on read — so a passive that buys
mana bought nothing at all until the next level-up or stat potion happened to rebuild
the pool. Any rank change now re-derives both, and grants the freshly-gained points.

## Retribution — Chadwick, tier 1 — DONE

Brace for **5 HP** (never lethal — the button refuses rather than killing you) and
reflect every blow that lands, for 50 turns, on a 100-turn cooldown.

| rank | reflect | regeneration |
|---|---|---|
| 1 | ×0.5 | — |
| 2 | ×1 | — |
| 3 | ×2 | ×2 |
| 4 (level 10) | ×3 | ×5 |

It reflects off the damage that **actually landed**, after RES and armour — bracing
behind a shield should not turn you into a bigger mirror — and before the gear's own
thorns enchants, which still stack on top.

Measured at rank 2 (×1): 22 damage taken against 25 reflected. Those should match, and
do: the 3-point gap is regeneration topping the player up inside the same turn, so the
*measured* damage is net while the reflect works off the gross hit.

## Breaking line of sight is a tactic again — DONE

`HUNT_PATIENCE` **10 → 2**. A hunting monster that cannot see you for two consecutive
turns gives up, drops to searching near where the trail went cold, and `aware` goes
false with it — which is what makes your next blow a guaranteed hit.

At 10 this was not a tactic: you had to stay hidden for a third of a fight before
anything forgot you, so nobody ever did it, and the deliberately evasive monsters had
no counterplay but swinging and missing. At 2 it is the Shattered Pixel Dungeon move —
step behind a pillar, let it lose you, come back and land one for free. **That is what
makes a bat at AC 21 and a snake at 22 fair rather than merely annoying:** they are
supposed to be hit by playing well, not by rolling well.

Measured: a hunting rat forgets the player on the **third** turn out of sight, exactly
as `++huntBlind > 2` implies.

A searching monster re-spots you the instant it can see you, with no roll, so the free
hit has to be taken from concealment — stepping into the open first hands the
awareness straight back. And `stopHunting` now floats a **"?"** over the monster when
it loses you, because an ambush window the player cannot see is luck rather than a
mechanic.

---

## The merchant floor grows a second and a third thing to spend on

The peaceful floor after each boss sold two things: potions at 20g and a full heal from
the fountain. Both are consumption. Gold had no route into progression at all, which is
why it piled up unspent in the late floors of a good run.

### The opening shelf is guaranteed

The three slots you walk in on are now **a Potion of Healing, a random stat potion
(Strength / Vitality / Intelligence), and one weighted roll.** Before this, all three
were weighted rolls, which meant the single shop between two bosses could hand you
poison, paralysis and stone skin — a run decided by weather rather than by play. The
opening hand is the thing you can plan the next biome around; everything past it is the
merchant's own stock.

### Rerolling costs a coin, then two, then four

**1 gold, doubling with each reroll on that floor: 1, 2, 4, 8, 16 …** The counter is per
merchant floor and restarts every visit.

The first reroll is deliberately not a decision — it is a coin, and a shelf you dislike
should not be a wall. The doubling is what stops it becoming one: by the fourth reroll
you have spent a potion's worth of gold, so hunting for an exact shelf costs the thing
you were shopping for. And a reroll replaces all three slots with weighted rolls, so the
opening guarantee is spent the moment you use it — rerolling a heal away can genuinely
leave you worse off. That risk is what makes it a choice rather than a button.

### The altar sells a god, not a boon

**100 gold buys one god's attention.** They then put **three random boons you don't
already hold** in front of you, and you keep one.

What is on sale is deliberately the *god*, not the boon. Paying narrows the roll to a
domain — Maelon's attrition, Ourn's tempo, Kethara's faith, the Guild's itemisation —
without letting gold simply buy the exact boon you wanted. You are choosing what kind of
run to have, and then taking what that god happens to offer.

Which gods are listening is **rolled once per merchant floor**, up to three of those who
still have something to give, so closing the panel and reopening it is not a free
reroll. A god whose roster you have exhausted drops off the shortlist entirely, and when
every god has given all they have the altar says so rather than taking the coin. The
gold is only deducted once there is something to hand over.

The rosters live in `data.js` under `gods.<key>.boons` — arrays that had sat empty since
the gods table was written. Kethara has 5, Maelon 6, Ourn 6, the Guild 5; The Label and
the sealed Auvris have none yet and so never appear at the altar. Adding a boon to a
god's array is all it takes to put it on sale, which is the point of keeping the mapping
in data rather than in the engine.

`offerBoons()` grew an optional pool argument to support this. Called bare — at a boss
kill, at the start of a run — it draws from every boon you don't hold, exactly as
before; the altar passes one god's roster so a paid offer stays inside the domain that
was paid for.

---

## Two more stat draughts, and the incoming-damage order written down

**Potion of Dexterity** and **Potion of Resonance** join Strength, Vitality and
Intelligence: a permanent +1, same as the others, drop weight 1 to match the two
newest rather than Strength's 2. They also join the merchant's guaranteed opening
stat slot, which now draws from five potions instead of three.

The cost of adding them is dilution: the drop pool goes from 14 weight to 16, so a
Potion of Healing falls from 35.7% of a potion drop to 31.3%. On the merchant's shelf
(which weights the two harmful draughts down) it goes 33.3% either way, because the
opening heal is guaranteed regardless.

### The order an incoming attack is resolved in

Every monster blow — melee, ranged, and a charge — runs through the one `attack()`
path, in this order:

1. **Attack roll vs AC.** `d20 + the monster's toHit ≥ playerAC()`. Miss and nothing
   else happens.
2. **Evasion.** A separate roll against `dodgeChance()`, taken only after the attack
   roll already beat your AC — the blow was aimed true and you slipped it. Being hard
   to *aim at* and hard to *hit* are deliberately different stats.
3. **Percentage reduction — RES.** `dmg × (1 − m/(m+10))`, where m is the RES
   modifier. This is the only percentage cut in the game; every other defensive
   source is flat, and so lands in step 4.
4. **Flat mitigation — armour.** `armorBlock()`: the worn armour's def roll, plus the
   heavy sub-type's flat soak, plus worn `defense` enchants, plus Stone Skin. Then a
   floor of 1, so nothing is ever fully negated.

A charge's momentum bonus is added *after* all four, on purpose — see the comment in
`attack()`. Healing Smite's shield eats what is left before HP does.

Measured against a keener (8–12 damage, mean 10.0) with armour stripped, dodge at 0
and 3,800 landing blows per tier — every figure matching the rounding model exactly:

| RES | mod | cut | predicted mean | measured |
|---|---|---|---|---|
| 10 | +0 | 0% | 10.0 | 9.991 |
| 12 | +1 | 9.1% | 9.0 | 8.984 |
| 14 | +2 | 16.7% | 8.4 | 8.398 |
| 16 | +3 | 23.1% | 7.6 | 7.590 |
| 20 | +5 | 33.3% | 6.6 | 6.575 |
| 24 | +7 | 41.2% | 5.8 | 5.786 |
| 30 | +10 | 50% | 5.2 | 5.201 |

With rusted mail (1–5) on top: RES +0 measured 6.985 against a predicted 7.0, and RES
+10 measured 2.438 against a predicted 2.2 — the gap there is the floor of 1 catching
the lowest rolls, exactly as it should.

`window.cantori.monsterHit(i)` drives one monster's attack straight at the player,
outside its AI, and returns what landed. That is what makes this order measurable
rather than argued, and it is worth keeping for the next time the question comes up.

### What does NOT go through it

Steps 1 and 2 are attack-roll concepts and can't apply to a bomb. Steps 3 and 4 could,
and today do not. These land raw:

- **Boss telegraphs.** The Piper's exploding rat (30 flat), the golem's boulder
  (15–30), its ground slam (20–60), its node blast (0–20). These are the largest
  numbers in the game and the ones RES and armour do nothing about.
- **Traps.** Arrow and bomb.
- **Damage over time.** Burn and poison ticks. (The toxin's %-max-HP halving is
  deliberately outside all of it.)
- **A monster's death burst.**
- **Thorn terrain**, and the self-inflicted costs (wall slam, Retribution's 5 HP).

The defensible reading is that a telegraphed AoE is answered by moving, not by
armour. The problem is the size: 20–60 unmitigated from a ground slam is most of a
mid-game health bar whatever you are wearing, so defensive investment has no say in
the fight the player most wants it to.

---

## The ladder is now one function, and everything climbs onto it

The order was already right for a monster's blow, but it was written *inside*
`attack()`, and every other source of damage simply didn't have it. That is how the
Golem came to hit for 20–60 with armour and RES watching from the sidelines: nothing
was wrong with the code, there just wasn't any shared code to be wrong.

`incomingDamage(dmg, rung, opts)` now holds all four rungs, and `attack()` is one of
its callers rather than the place it lives. A source picks where it **enters**; from
there it runs every remaining rung.

| Source | Enters at | Gets |
|---|---|---|
| Melee, ranged, charge | 1 to-hit | AC roll, evasion, RES, armour |
| **Boss telegraphs** | 1 to-hit | AC roll, evasion, RES, armour |
| **Traps** (arrow, bomb) | 2 evade | evasion, RES, armour |
| **Burn and poison ticks** | 4 tick | RES only — armour is skipped |

### Boss telegraphs roll to hit

The Piper's exploding rat, the Golem's boulder, its ground slam and its node blast all
call `bossHit()`, which enters at rung 1 with that boss's own `toHit` (Piper 3,
Golem 6). Standing out of the line is still the first defence — every one of those
moves checks position before it ever reaches the ladder — but it is no longer the
*only* one.

A playbook that wants a move to bypass a rung says so at its own call site with a
reason. That is the "unless stated in the boss move set" escape hatch, and it is a
deliberate one-liner rather than a data field, because a move that ignores armour
should have to be argued for in a comment next to the code that does it.

The Golem's node still heals it by exactly what **lands**, so armour and RES now cut
the transfusion as well as the wound.

### Traps enter at evasion

Nothing about a pressure plate can be parried, so there is no attack roll — but you
can throw yourself clear of it, and a breastplate still catches the arrow. Measured on
depth 8 with no armour: an arrow trap's mean landed damage falls from **8.68 at RES 0
to 4.70 at RES 50%**, and evasion turns a share of them aside entirely, which it never
did before.

### Ticks get RES and nothing else

A burn or a poison is already inside you: nothing left to dodge, and no plate between
it and your blood. Measured with regeneration switched off (the floor's spark out, so
an HP delta *is* the damage):

| RES cut | burn of 20 | poison of 12 | with rusted mail |
|---|---|---|---|
| 0% | 20 | 12 | identical |
| 33.3% | 13 | 8 | identical |
| 50% | 10 | 6 | identical |

The stored tick keeps decaying at its own rate, so RES softens each tick without
changing the burn's shape.

### The ladder itself, measured

`window.cantori.ladder(dmg, rung, acc)` runs one figure down it — the same call every
telegraph, trap and tick makes. 4,000 samples per case:

| Case | hit rate | mean when it lands |
|---|---|---|
| Piper's rat (30, toHit 3) vs AC 11, no armour, RES 0 | 65.5% | 30.00 |
| …with rusted mail (1–5) | 70.3% | 26.98 |
| …mail + RES 50% | 69.9% | 12.01 |
| Golem slam (40, toHit 6) vs AC 11, no armour, RES 0 | 80.6% | 40.00 |
| …mail + RES 50% | 85.1% | 17.01 |

Every mean is exactly `round(raw × (1 − cut)) − 3`, the 3 being rusted mail's average
block. End to end, a real Piper fight on depth 5 produced the "turned aside" branch —
a rat line that resolved without doing 30 damage, which was not a thing that could
happen before.

### Left raw, on purpose for now

A monster's death burst, thorn terrain, and the self-inflicted costs (Dragon Kick into
a wall, Retribution's 5 HP). The toxin's %-max-HP halving stays outside everything by
design. Any of them joins the ladder the same way: pick a rung at the call site.

### A dev-surface fix that had already cost two measurements

`setStat` poked a stat without recomputing `maxHp`/`maxMp`. The pools are **stored,
not derived on read**, so raising VIT to 120 left the test character on 20 HP — and a
"burn does 0 damage" reading that was really the character dying. It now recomputes
both and grants the difference, like every other path that moves a stat. Also new:
`monsterHit(i)` drives one monster's attack outside its AI, and `ladder(dmg, rung,
acc)` runs the ladder directly.

---

## The one field in the burst block that lies

`burstDmg` is a **sentinel, not a literal**:

```js
const top = Number(src.burstDmg) > 0 ? Number(src.burstDmg) : depth;
```

0 or blank means *"scale with the floor"*. The Hollow Acolyte is authored at
`burstDmg: 0`, so its blast rolls **1–11 on depth 11 and 1–15 on depth 15** — not
nothing. Confirmed in play: killing one on depth 11 produced blasts of 1 to 7, where a
literal reading of the 0 would have given a flat 1 every time.

Every other field in the block *is* a literal: a percentage of the damage that victim
just took. `burstMp: 100` tears off mana **equal to the damage dealt**; it does not
empty the pool. Measured on a level-30 warrior with a 62-point pool: blasts of 10, 6
and 5 took exactly 10, 6 and 5 MP. The tear is capped by the mana you actually have,
which is why a warrior shrugs it off and a caster pays twice for standing too close.

So a plain `0` sitting in a box labelled "burst dmg" reads as "no damage" and means the
opposite. Rather than change the behaviour — a literal 0 meaning "none" would silently
alter any future row — the shorthand is now stated everywhere it can be read:

- the editor's column header is **"burst dmg (0 = depth)"**, and `burstRadius` says
  **"(blank = no burst)"** because that is the switch that turns bursting on at all;
- the burn/poison/MP columns say **"% of dmg"** rather than bare "%";
- the reference tab's one dense "Death burst" row is now five, one per trap;
- `deathBurst()` carries the warning at the line that does it.

The cost of the shorthand, stated plainly so it can be reversed later: **a burst that
deals no direct damage and only applies the statuses cannot be authored today.** If
that turns out to be wanted, the fix is to move the sentinel to blank and let a literal
0 mean zero.

### Two measurement traps this turned up

Both are the same shape as the `setStat` one — the instrument, not the mechanic:

- **The floor's spark gates HP regeneration only.** MP regeneration has no
  `sparkGone` guard, so a high-INT mage refilling 4+ MP a turn swallowed the entire MP
  tear and made `burstMp` read as zero. Measure mana on a slow-regen character.
- **A kill grants XP**, and a level-up raises `maxMp` mid-action. Any before/after read
  across a kill has to discard samples where `level` or `maxMp` moved.

---

## The death burst joins the ladder, and the ladder grows a second axis

A burst should roll to hit, be dodgeable, and be resisted by RES — but armour should
be no help at all. You can be *clear* of a body coming apart; you cannot *plate* your
way out of standing next to one.

The ladder as first written could not say that. Armour was welded to the entry rung:
"enter below evasion" implied "and skip armour", which covered a burn tick and nothing
else. So the model gained the axis it was actually missing — **where a source enters,
and whether armour answers, are separate questions and are now separate arguments.**

`DMG_TICK` is gone as a rung; there are three entry points and a `noArmor` flag:

| Source | Enters at | Armour |
|---|---|---|
| Melee, ranged, charge | 1 to-hit | yes |
| Boss telegraphs | 1 to-hit | yes |
| **Death burst** | **1 to-hit** | **no** |
| Traps | 2 evade | yes |
| Burn / poison ticks | 3 reduce | no |

Measured on the ladder directly, 4,000 samples a case, a 20-damage figure at `toHit 3`
against AC 10–11 with rusted mail (1–5) worn:

| | burst (no armour) | an ordinary blow |
|---|---|---|
| RES 0, no armour | 20.00 | 20.00 |
| RES 0, **mail on** | **20.00** | 17.01 |
| RES 50%, mail on | **10.00** | 7.02 |

Armour changes the burst by nothing and the blow by mail's average 3. RES halves both.
Hit rates track each other at 65–70%, so AC and evasion answer a burst exactly as they
answer a bite.

### Turned aside means turned aside

The follow-on effects are all shares of the damage that victim took, so a burst that
misses or is dodged now applies **no burn, no poison, no mana tear — and no stun
either**, which is the one that needed saying: the stun rolls independently of the
damage, so without the gate a dodged blast would still have frozen you. Confirmed live:
a blast that went wide left poison, burn, stun and MP all untouched.

Monsters caught in a burst are unchanged — they take it raw, as they always did. The
ladder is a player-side thing.

### Sampling note

The live end-to-end runs are thin — two or three blasts a run, because the
spawn-adjacent-and-kill harness fails more often than it fires. The unit-level numbers
above are exact and come from the single shared function every one of these call sites
uses, so the behaviour is not in doubt; the field data is corroboration, not the proof.

---

## Bought stock is identified stock

Buying a potion now identifies it for the rest of the run.

There was never a secret being kept here. The merchant's shelf lists every bottle by
its real name, and the purchase line says *"You buy a Potion of Healing."* — and then
the pack went on calling the thing in your bag an **Ochre Potion**. That was the UI
disagreeing with itself, not a discovery the player still had to make, and it meant the
one place in the game where you are told exactly what you are getting was also the
place the information got thrown away.

Identification is by **key**, so a purchase also names any copies you were already
carrying: buy one Potion of Healing and the three unlabelled bottles in your pack turn
out to have been healing all along. That is precisely what learning what the ochre
bottle *is* should mean, and it is the same rule that already applies when you drink
one.

Measured: carrying an unbought copy showed **"Umber Potion"**; clicking the shop row
turned that same pack entry into **"Potion of Healing"**, gold went 500 → 480, and a
potion sitting on the shelf that was never bought stayed a **"Charcoal Potion"**.
Nothing is identified by proximity — only by paying for it.

---

## Necklaces and trinkets stop being stat sticks and start being skills

Both slots carried what every other slot carried — a stat, an enchant, a number —
which made them the least interesting things you could find. They now carry **skill
ranks**, and the two slots answer different questions:

- a **necklace** grants ranks in a skill from **the class you are playing**: it sharpens
  who you already are;
- a **trinket** grants one from **somebody else's tree**. That is the entire reason the
  slot exists. ToneTum can find a charm that lets him Spin, and no amount of levelling
  would ever have got him there.

### The tables

| Rarity | Ranks | Stats | Enchants |
|---|---|---|---|
| white | — | — | **cannot roll** |
| green | +1 | 0 | none |
| blue | +1 | 1 | none |
| purple | +2 | 1 | none |
| gold | +3 | 2 | none |

No enchants on either slot any more: an amulet that also happened to be Flaming would
bury the thing it is actually for under a proc. White is impossible — the rows carry a
new `minRarity: "green"`, because a white necklace would now be an *empty* slot rather
than a modest one.

Which rows a piece can reach is **ceil(tier / 2)** — tiers 1–2 the first row, 3–4 the
first two, 5 the first three. That interpolates the 1 / 3 / 5 rule onto the even tiers
instead of leaving them rolling nothing. Eight new rows were authored so every tier
exists in both categories; the Metrognome opts out with a new `noGrant`, because its
walk/attack variant is the point of it.

They are also scarcer than they were: `categoryWeights` moves **necklace 10 → 4** and
**ring 12 → 14**. A slot that hands over a skill should not drop as often as one that
hands over a number.

### Spent ranks and granted ranks are different things

Granted ranks **never enter `player.skills`**. `skillRank(key)` is spent + worn, capped
at the skill's max. The split matters in both directions:

- **spent** ranks are what the point counter and the prerequisites read, so an amulet
  can never buy its way down the tree;
- **granted** ranks are what the *effect* reads, so the amulet does what the card says.

Take it off and the ranks leave with it, because nothing was ever written down.

**Level gates still bite; prerequisites do not.** A trinket hands an off-class skill to
someone who could never satisfy its tree, so `req` / `reqAny` / `reqPoints` are ignored
outright — but the row's own level and any per-rank `minLevel` clamp the grant to 0.
That is what stops a tier-5 amulet being a level-1 shortcut.

A rolled or scrolled **+X raises the grant by a rank per point**, the same way it raises
a stat affix. It clamps at the skill's max soon enough, and that clamp is the brake.
Trinkets still refuse the Scroll of Upgrade, as they always have.

### Measured

A mage run, 400 rolls per row:

- necklaces offered **only ToneTum's skills**; tiers 1–2 stayed inside row 1
  (Burning Sensation, Keen Intellect, Magic Missile, MP Recovery, Sleep) and tiers 3+
  added row 2 (Blink, Madness, Mirror Image).
- trinkets offered **only monk and warrior** skills, never the mage's own; tier 1 stayed
  in row 1 and tier 5 reached row 3 (Healing/Raging/Spinning Smite, Happy Feet, Now You
  See Me).
- no white ever rolled; the Metrognome granted nothing across 200 rolls.
- a tier-5 necklace forced to each rarity gave exactly 1/0, 1/1, 2/1, 3/2 ranks/stats
  and zero enchants.

End to end: ToneTum's hotbar read *Wait, Magic Missile*; equipping a purple trinket
granting Spin made it *Wait, Magic Missile, **Spin*** at rank 3, the card read
**"Spin +3 (Chadwick), +6 LCK"**, and casting it worked and started an 79-turn cooldown.
Burning Sensation at 2 spent plus a +2 necklace read **4**, still 4 with the item at +3
(the max clamp), and **2** again the moment it came off. Blink granted at level 1 read
**0**, and **4** at level 9.

### Two things worth knowing

**Grants are not gated on identification.** The house rule is that gear works fully
while unidentified and you simply cannot read its numbers, so an unknown amulet grants
its ranks like an unknown sword swings its damage. The consequence: an unidentified
trinket's *active* skill appears on the hotbar before the card will name it. That is the
same bargain as feeling a sword hit harder than it reads, and better than a slot that
silently does nothing for the first thirty hits.

**A bug this turned up.** Making the skill-tree cache a per-class map left a stale
`_skillCache = {…}` assignment inside `applyClass`, which now threw on *every* class
pick — including the one at boot. The whole first measurement run was against a
character that had silently stayed a warrior. Neither suite caught it, because both
drive the game through paths that survive a failed class application.

---

## Water stopped being a wall for the purposes of turning a corner

A snake sat motionless in a pond's corner and would not move. Monsters have always
moved on all eight directions — the block was the **corner rule** in `canStep`, which
refused a diagonal whenever both orthogonal flanks were impassable *to that mover*.
Deep water counted, so a pond flanked like masonry.

Measured over 600 generated floors and 4,680 monsters, that sealed roughly **1 monster
in 4,700** — and the shape is unmistakable once you see it: a bear on **dry floor**,
wall to the west, water north, east and south. Its only two exits were the north-west
and south-west diagonals, and each was refused for being flanked by the wall *and* a
water tile. Nothing repairs that afterwards: `fixOpenCorners()` only sweeps wall/floor
touches, and water is not `solid`, so it is invisible to the one pass that exists to
prevent exactly this geometry.

It bound the **player** too — `playerAct` and auto-travel both ask `canStep` — so the
same pond could have walled a run into a corner it could not walk out of.

The rule now asks whether a flank is a *real barrier*: `solid` (wall, tree) or a
shunned hazard (thorn, chasm). Water blocks you **entering** it, never rounding it.

| Flanks | Before | Now |
|---|---|---|
| wall + wall | blocked | blocked |
| thorn + thorn | blocked | blocked |
| wall + thorn | blocked | blocked |
| **wall + water** | **blocked** | **allowed** |
| **water + water** | **blocked** | **allowed** |

What that gives up, deliberately: a walker may now cut the corner between two ponds
rather than walking the shore. That is a one-tile shortcut at the water's edge, and it
was never worth a creature frozen in place — water was never meant to be a wall, which
is what the TILE table already says by pointedly not marking it `solid`.

### And one that no diagonal could have fixed

The same probe turned up a second, rarer case: a bat on a **one-tile island** — water
on seven sides, wall on the eighth. There is genuinely nowhere to step. It could never
move, never be reached and never be fought, while still counting on the floor's enemy
tally, which reads as a monster you cannot find.

`paintTerrain`'s connectivity vetting is about **rooms** and the way onward, so a single
stranded tile *inside* a room survives it. Rather than teach the painter about islands,
the spawner now refuses them: an initial spawn must sit inside `floodReach` from where
the player is standing, which is already computed from the player's own start tile a few
lines earlier.

After both: **600 floors, 4,680 monsters, zero sealed** — against 1 sealed and 1 island
on the same measurement before. `canStepAt` joins the dev surface so a test can ask the
engine what it permits instead of reimplementing the rule and then measuring its own
copy — which is how the first pass at this nearly reported a fix that had not happened.

---

## A sprung trap stops you walking

Auto-travel was never cancelled when you stepped on a trap. You would arm a bomb's
three-turn fuse and keep strolling — the game taking the decision away at the exact
moment there is one to make, because *where you are standing when it blows* is the
whole mechanic.

It is cancelled at `triggerTrap` itself rather than at the one call site that walks
you onto one, so every trap covers it: an arrow that just hurt you, and a teleport
rune that just moved you somewhere the rest of the path was never computed from. A
trap sprung **remotely** — by throwing something at it from a distance — cancels
nothing, because that is a deliberate act, not an interruption. The bomb's actual
detonation clears the path again, in case you had started walking in the meantime.

Measured: a normal walk queues 38 steps and keeps going; a bomb springing underfoot
takes 21 queued steps to **0**, an arrow trap 41 to **0**.

## The forest was a hall, not a hub

The floor was a tree. Between any two points there was exactly one route, so there
was never a choice about how to get anywhere — which is the thing that makes a floor
feel like a corridor with rooms bolted on.

There *was* an extra-loop pass, and it did nothing. It rolled 15% per room and then
joined that room to its **nearest** neighbour — but both the flush-attach pass and the
spanning tree already prefer the nearest room, so the "extra loop" was almost always a
room it was joined to already. It carved the same route twice.

Measured over 40 forest floors, by the share of corridor tiles that are **cut
vertices** (a tile where being blocked cuts part of the floor off — a chokepoint with
no way round): **84.8%**, with 35 of 40 floors above 85% and not one floor below 50%.

The pass now requires a partner the room is **not** already joined to, picking the
nearest such room so the corridor stays short. The graph is fully connected by that
point, so every edge added closes a real cycle by construction. How many is a new
`loopPct` knob in each biome's `layout` block.

| loopPct | corridor chokepoints | floors reading as a hall (≥85%) | floors with real freedom (<50%) |
|---|---|---|---|
| 0 | 90.6% | 35 / 40 | 0 |
| 30 | 62.2% | 4 | 10 |
| **60** | **60.2%** | **2** | **14** |
| 80 | 58.5% | 1 | 12 |

Nearly all the gain is bought by the first thirty. Past that, each new corridor brings
its own spur tiles — which are themselves chokepoints — so the ratio plateaus while the
floor keeps sprawling. **60** is the shipped default: the hub-with-spokes shape becomes
the norm, and the occasional single-path floor survives, which is the point. Those are
good; they just should not be every floor.

`loopPct` lives in `LAYOUT_DEFAULT`, so it reaches every biome including the crypt,
whose authored `layout` sets `attachPct: 0` and a long `hallLegMax` for a deliberately
corridor-heavy feel. If that biome wants to stay maze-like, one field on its layout
block dials it back.

---

## The way out now leads out

A stone arch stood in the middle of a forest clearing with explored ground on both
sides of it. It read as scenery, and it was a dozen steps from where the run started.

The first thing to check was the obvious suspect — that the exit had stopped being
embedded in a wall, perhaps because the new `loopPct` corridors were carving through
room rings. It had not: measured across 160 floors, 80 with the extra corridors and 80
without, the exit was on a room's wall every single time, with one open side on 149 of
them. That part of the rule was working exactly as written and the corridor change made
no difference to it.

What the rule never asked was **which side the wall opened onto**. A wall tile between
two rooms is still a wall tile, so the stairs could legitimately land in a partition
halfway across the level — a door between two rooms rather than a way out of the place.

Two conditions decide it now:

1. **Rock behind it.** Walking outward from the room, the next 4 tiles must be solid,
   with the map boundary counting as solid. That is what separates an exit *from* the
   level from a door *within* it.
2. **Far from the start**, by walking distance rather than a straight line, so the
   floor has to be crossed to reach it.

The doorway shape — a wall tile flanked by wall on both sides — is kept as the
first-choice pass, with three progressively looser passes behind it so a cramped floor
still gets stairs rather than none. The old last-resort that dropped the stairs in a
room's *centre* is still there and still never fires.

Measured over 120 floors afterwards:

| | before | after |
|---|---|---|
| exactly one open side | 149/160 | **120/120** |
| opens onto ≥4 tiles of rock | not asked | **120/120** |
| in the far half of the floor | not asked | **120/120** |
| floating inside a room | 0 | 0 |

### Why it is not simply the furthest tile

The first version took the maximum walking distance outright, and that put the stairs at
**96% of the floor's maximum on 117 floors out of 120** — which is its own kind of
predictable. Every floor became "head for the far corner". It now rolls at random among
everything in the far quarter, which keeps the average at 90% of maximum and all 120
floors in the far half, without the way out being in the same place every time.

**Boss floors are untouched.** There the exit opens on the boss room's wall nearest to
where the boss fell, because the point is that killing the thing opens the way — not
that you then go looking for it.

---

## The pack's detail line said `spd` twice

`dmg 3–8 · spd 0.8 · spd 0.8, to hit −2, +1 RES`

Two functions each thought they owned the weapon's intrinsic numbers.
`detailHeaderHTML` printed `dmg … · spd …` itself, then appended `itemAffixText()`,
which leads with the same speed for weapons. To-hit only ever appeared in the second
copy, where it sat in the affix list and so read as something the item had *rolled*
rather than what the weapon simply is.

`itemAffixText(inst, skipBase)` now takes a flag. The detail header prints the whole
intrinsic set — damage, speed, to-hit — and passes `skipBase: true`, so the affix list
carries only what the roll added. Everywhere else it is called (the equipped-slot
cards) that text is the only text there is, so it keeps them.

`dmg 3–8 · spd 0.8 · to hit −2 · +1 RES`

The unidentified branch is untouched and mutually exclusive with the affix one, so an
unknown hatchet still reads `dmg 3–8 · spd 0.8 · to hit −2 · unidentified (0%)` — the
base row's numbers belong to the item type rather than to the roll, which is why they
show before you have identified anything.

## The patience clock only runs when the chase is going nowhere

A bat kept not following the player into a bush. It turned out not to be about
bushes being unwalkable — monsters enter them fine, and when the bat was directly
behind the player it followed straight through and attacked. The failure needed
distance to show up:

```
step1  player enters the bush     bat 4 tiles back, hunting
step2  player exits; bush closes behind
step4  bat -> WANDERING, aware false      <- gave up mid-chase
wait1  bat reaches the bush -> hunting again
```

It never refused the bush. It **gave up before reaching it**. `HUNT_PATIENCE` — cut
from 10 to 2 earlier to make breaking line of sight a real ambush tactic — started
burning the instant sight broke. In a forest every room mouth holds a bush, bushes
block sight, and they close behind whoever walked through. So walking from one room to
the next broke the chase, and ordinary movement was springing the ambush by accident.

The clock now runs only while the chase is going **nowhere**: the monster has reached
the end of the trail and still cannot see you, or it could not move at all this turn
(jammed against something it will not cross — the case the old early give-up existed to
catch). While it still has ground to cover toward where it last saw you, it is chasing,
and chasing is not giving up.

The ambush never depended on the monster losing you *instantly*. It depends on the
monster walking to where you **were** while you are somewhere else — it just has to get
there first now.

| | before | after |
|---|---|---|
| chases surviving a bush | 1 / 5 | **5 / 5** |
| monsters forgetting a vanished player | — | **8 / 8, in 1–2 turns** |

### Two measurement traps, both mine

The first probe teleported the player with `place()` instead of walking, so the bat
looked frozen on the bush when it had actually closed to melee and was attacking. The
second put the player *adjacent* to the monster while "fleeing", so it took the
`d === 1 -> attack` branch every turn and never reached the trail logic under test at
all — reading as "the ambush is broken" when nothing was. Both times the instrument was
wrong, not the game. Stepping deliberately **away** from the monster, and reading its
trail target and blind counter rather than only its position, is what finally measured
the thing itself.

## The Scroll of Upgrade never learned its own name

Use one and the next copy in the pack still read *Scroll titled "Hagalaz"*.

It was the only consumable in the game that never identified itself, and for a
structural reason: `actItem` routes an upgrade scroll to `beginUpgrade()` rather than
`useConsumable()`, because it has to ask which item to spend itself on first — and
`identified.add(it.key)` lives in `useConsumable`. Every other potion and scroll passes
through that one line. This one never did.

It is identified when it is **spent**, in `confirmUpgrade`, rather than when it is
armed. Arming is cancellable, so a scroll you could name by arming it and backing out
would identify the whole stack for free.

Measured: armed and cancelled, it stays *Scroll titled "Hagalaz"*; spent on a weapon,
it becomes **Scroll of Upgrade**, the weapon goes to +1, and the log reads *"It was a
Scroll of Upgrade!"* — the same line every other consumable prints on first use.

---

## More loot, and LCK finally earns its slot

### The drop rate went up, measured rather than calculated

The split alone could not do it. `dropWeights` is a three-way share, so raising gear
and consumables together has to come out of gold — and gold was meant to stay put. The
per-floor **count** goes up instead, and the split is re-normalised around the new
totals.

The first attempt derived the target from the config on paper and was simply wrong: the
old floor was supposed to average 2.05 gear and 0.66 consumables, and actually averaged
**2.22 and 0.92**. Everything below is measured over generated floors instead.

| per floor | before | after | asked for |
|---|---|---|---|
| gear | 2.22 | **2.54** | ×1.15 → ×**1.145** |
| consumables | 0.92 | **1.20** | ×1.25 → ×**1.31** |
| gold | 0.56 | **0.54** | unchanged → ×**0.96** |

Count is now `randInt(2, 5)` with a `0.125 × count` chance of one more; weights are
14 / 60 / 26. Consumables land a little generous — run-to-run variation is around **±4%
even across 700 floors**, which is the same order as the precision being asked for, so
chasing the last few points would be fitting noise. Worth knowing before anyone tunes
this again: measure it, don't derive it.

### LCK now does four things

It was a crit stat and nothing else. Each is driven off the ability modifier, so the
numbers below are per point of *modifier*, not per point of score.

| | rate | measured |
|---|---|---|
| Crit | +2 pp | unchanged |
| **Evasion** | +1 pp of dodge | modifiers 1/3/5/10 → exactly 1% / 3% / 5% / 10% |
| **Loot** | white −1 pp, redistributed **proportionally** | white 50.4 → 44.0 → 39.8% at modifiers 0/5/10 |
| **Traps** | ×2 pp chance it doesn't go off | 0% / 9% / 20.8% / 31.2% at modifiers 0/5/10/15 |

**Evasion** shares the one 50% cap, so luck cannot stack past it either.

**Loot** redistributes *in proportion to what each rarity already had*, not equally — a
lucky character does not suddenly see gold at green's rate; the whole table above white
scales up together. Green went 33 → 37 → 40 while purple went 4.7 → 5.2 → 5.8. It
composes with the Guild's Blessing, which keeps spreading its own share **equally**,
because that is what the boon card promises.

**Traps** reveal but do not spring: the thing is still live under your feet, you can now
see it, and walking off is free. A near miss you get to notice rather than a silent coin
flip. It does not apply to a trap sprung remotely by throwing something at it — that was
never going to catch you.

The character screen said `LCK — 11% crit` and left the other three invisible; it now
names all four. DEX's line also only offered a dodge figure when `evasionPoints() > 0`,
which stopped being the right question the moment luck could buy dodge on its own.

### A measurement note

The trap effect first read as **0% at every luck value**. The cause was the probe, not
the game: it scraped the message log by a running index, and the log panel only retains
its last few lines, so every read after the first came back empty and scored as "the
trap fired". Reading the trap's own `sprung` flag gave the numbers above immediately.
That is three separate times this session that log-scraping or a stale copy has produced
a confident wrong answer — prefer engine state to rendered text.

---

## A passage that exists goes somewhere

Walking a spoke to a three-tile grass nook and finding nothing is the worst thing a
floor can ask of you: it costs real turns against the Horror clock, pays nothing, and
there is no way to tell it from a passage that leads somewhere until you have already
walked it.

Every empty pocket now leaves generation in exactly one of two states:

- **up to two per floor** get a hidden room dug behind their far wall, stocked with a
  guaranteed gear drop, a consumable and a coin flip for gold;
- **every other one is filled in**, so the walk is never offered.

Leaving one as it was is not an option — that was the bug.

### The measurement was wrong twice before it was right

First I counted dead ends as *tiles with one orthogonal neighbour* and got **7.18 per
floor**. Then I sealed them and the number barely moved, because the sealer used the
same test and `GRASS` is passable but is not `FLOOR` — so every grassy dead end, which
in a forest is most of them, was invisible to both passes.

Fixing that still left the number stuck, and the reason was more interesting:
**movement is 8-way**. A tile with one orthogonal neighbour and two diagonal ones is not
a dead end at all. Counted properly, a floor had **0.1** of them. My 7.18 was an
artifact, and the thing the player actually walked into was never a one-tile stub.

It is a **pocket**: a patch of ground with a single way in and nothing inside. Found by
cutting — block one tile, see what strands — over chokepoints only, so a few dozen
floods a floor rather than one per tile.

| per floor | before | after |
|---|---|---|
| empty pockets surviving | 2.65 | **0.45** |
| floors with none at all | — | **41 of 60** |
| hidden rooms | 0 | **1.58** |

One sweep was not enough: filling a pocket turns whatever led to it into a nook of its
own, so the pass repeats until the floor stops producing them.

### An undiscovered door is just a wall

No new terrain type. The door stays an ordinary `WALL` until found, which satisfies
CLAUDE.md rule 5 for free — every predicate in the game already knows what a wall is,
and the chamber behind is simply unreachable. It is not in `rooms` either, so the exit,
the monster spawner and the item scatter all pass it by. Verified across 60 floors:
**no secret room was ever reachable before being found**, and across 14 descents
including boss and merchant floors, all 19 doors were valid walls on the current map.

That last check found a real bug: `secretDoors` was cleared inside the generation pass,
which boss floors and the merchant den never run — so a door found on floor 4 stayed in
the list on floor 5, pointing at whatever now occupied that tile. It is cleared in the
per-floor reset now, beside `items` and `traps`.

### Waiting is searching

Rather than a sixth button on a phone screen, the verb the player already has for
"spend a turn doing nothing" is the one that finds a door — which is what waiting at a
dead end means anyway. Standing beside an unfound door prints *"The wall here sounds
hollow"* once, so a secret nobody can tell is there never happens, and **adjacency is
enough**: a door you must guess the exact tile of is a pixel hunt, and the point of all
this is that arriving at a dead end stops being a punishment.
