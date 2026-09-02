# B8 — three smites, choose one

**Depends on:** nothing.
**Touch only:** `game.js` (Skills section), `data.js`, `editor.js`, `index.html`.
**Read:** the "Skills" section (line range in `docs/MAP.md`) — `useSkill`, `prereqsMet`,
`prereqNames`, `treeSkills`, `learnSkill` — and grep `beginTargetedSkill` and `smite` for how
the existing Smite resolves.
**Do NOT read `game.js` in full.**

## Goal

Chadwick's Smite **upgrades into one of three**. Smite stays a real four-rank skill you learn and
use; once it is maxed you commit to Raging, Healing or Spinning Smite, and that variant takes
Smite's place on the skill bar. The three are **mutually exclusive**: spend a point in one and the
other two lock for the rest of the run.

Three pieces: a new exclusivity rule the engine does not have, a way for a variant to stand in for
the skill it upgrades, and modifier fields on the smite handler so all four are one behaviour with
variations rather than four near-identical functions.

## 1. Mutual exclusivity

`prereqsMet` knows two gates — named skills (`req`), any-one-of (`reqAny`) — plus the
`reqPoints` spend gate. It has no notion of "these are alternatives".

Add **`exclusiveGroup`**, a string. Any two nodes sharing one are mutually exclusive:

```js
// A choice, not a prerequisite: investing in one member of a group locks its siblings
// for the run. Group membership is symmetric, so a node never lists its rivals.
function exclusiveBlocker(d) {
  if (!d.exclusiveGroup) return null;
  const sk = classSkills();
  for (const id in sk) {
    if (id === d.id || sk[id].exclusiveGroup !== d.exclusiveGroup) continue;
    const st = player.skills[id];
    if (st && st.rank >= 1) return sk[id].name;
  }
  return null;
}
```

- `prereqsMet` returns false when `exclusiveBlocker` finds one.
- `prereqNames` explains it — "you have committed to Healing Smite" — rather than a bare refusal.
  A player who cannot see *why* a node is locked will assume it is a bug.
- **`treeSkills` builds each skill from an explicit field list. Add `exclusiveGroup` there, and
  `id`, or the lookup above cannot work.** A field missing from that list is silently dropped
  between `data.js` and the engine; this is the second time it has bitten.
- `editor.js`: authorable, same commit (rule 2).

Exclusivity is per run — `player.skills` resets in `applyClass`, so nothing to unwind.

## 2. The variant replaces Smite on the bar

Add **`supersedes: "smite"`**. While a node carrying it has rank ≥ 1:

- the superseded skill drops off the hotbar — one skip clause in `updateHotbar`, which already
  walks `player.skills` and filters passives — and `useSkill` refuses it, so it can't be fired by
  a stale binding;
- the variant takes its slot. The player keeps the ranks they spent on Smite; they are not
  refunded and not wasted, because —
- **a variant is a modifier on Smite, not a second damage table.** Base damage and attack cost
  come from the player's *Smite* rank; the variant's own rank fields layer on top and win on
  conflict. That is exactly what the authored text means by "dmg = Smite damage, heals for the
  same". A variant that sets no modifier fields behaves as plain Smite.

`treeSkills` builds each skill from an explicit field list — add `supersedes` there or it is
dropped silently between `data.js` and the engine.

## 3. Smite variants

Keep one `smite` kind. Add optional rank fields, each absent by default so the base behaviour is
unchanged:

| Field | Effect |
|---|---|
| `berserk: n` | the target is berserked for `n` turns (the state already exists — grep `m.berserk`) |
| `lvlDmg: 0.5` | add `playerLevel × n` damage |
| `healPct: 1` | heal the striker for this share of damage dealt |
| `shieldOverheal: true` | healing past max becomes a shield |
| `radius: n` | strike everything within `n` tiles instead of one target |
| `cdPerKill: n` | each kill takes `n` turns off the cooldown |
| `tempStat: { stats: ["STR","VIT"], amount: "level", decayEvery: "level" }` | Raging Smite rank 3 |

Reuse what exists: the `dots` system, `m.berserk`, `stoneSkin`'s pattern for a decaying timed
buff, and `executeSpin`'s adjacency sweep for `radius`. Do not write a second spin.

## 4. The data

**The tree layout and the prerequisites are already correct in `data.js` — do not move nodes.**
Smite sits at x0 y1 with four ranks; the three variants sit below it at y2. Each variant already
requires Smite at max rank (`req: [["smite", "max"]]`), and Spinning Smite additionally requires
Spin at max. The engine understands rank thresholds on `req` and resolves `"max"` to that skill's
own top rank, so there is nothing to build for that part.

What you add per variant: `exclusiveGroup: "smite"`, `supersedes: "smite"`, and the `ranks` array
built from the rank table already written into each node's `levels` text — cooldowns accumulate
(Healing Smite 100 → 90 → 80 → 70), and "level" in those formulas means the player's character
level.

**Do the handler work and the data in one commit**, or the variants draw in the tree and do
nothing, which is the state they are in today.

## One consequence worth surfacing, not silently resolving

Committing to a variant is permanent for the run, and the three are not equally good against every
biome. That is the intent — it is the warrior's one real build decision — but it means a player who
picks wrong lives with it for 25 floors. Say so in the skill descriptions, not just in the commit.

## Done when

- The three appear side by side where Smite was; taking one locks the others with a clear reason.
- Each does what its rank text says; the base `smite` behaviour is unchanged for a variant that
  sets no modifier fields.
- A fresh run offers the choice again.

## Verify

```sh
node tests/smoke.js
```
```js
cantori.pickClass('warrior'); cantori.grant(30);
for (let i=0;i<4;i++) cantori.learn('rush');       // open Smite's gate
for (let i=0;i<4;i++) cantori.learn('smite');      // max it — the variants need that
cantori.learn('raging_smite');
cantori.hotbar()                                    // Smite is gone, Raging Smite stands in its place
cantori.learn('healing_smite');                     // refused — already committed
cantori.skills()                                    // healing_smite still rank 0
cantori.restart(); cantori.pickClass('warrior');
cantori.skills().healing_smite.rank                 // 0, and selectable again
```
Then use each in a real fight and confirm berserk, the heal, and the radius all land.
