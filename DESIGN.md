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
