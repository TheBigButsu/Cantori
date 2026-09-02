# B8 — three smites, choose one

**Depends on:** nothing.
**Touch only:** `game.js` (Skills section), `data.js`, `editor.js`, `index.html`.
**Read:** the "Skills" section (line range in `docs/MAP.md`) — `useSkill`, `prereqsMet`,
`prereqNames`, `treeSkills`, `learnSkill` — and grep `beginTargetedSkill` and `smite` for how
the existing Smite resolves.
**Do NOT read `game.js` in full.**

## Goal

Chadwick's Smite becomes a **choice of three**. Raging, Healing and Spinning Smite replace the
base Smite node outright and are **mutually exclusive**: spend a point in one and the other two
lock for the rest of the run.

Two pieces: a new exclusivity rule the engine does not have, and modifier fields on the smite
handler so the three are one behaviour with variations rather than three near-identical
functions.

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

## 2. Smite variants

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

## 3. The data restructure — do it in THIS packet

The three variants currently sit below Smite and require it. After this packet they replace it:

| Node | was | becomes |
|---|---|---|
| `smite` | x0 y1, the only tier-2 skill | **deleted** |
| `raging_smite` | x0 y2, req `smite` | x0 y1, `reqAny` the tier-1 trio at rank 4, `exclusiveGroup: "smite"` |
| `healing_smite` | x1 y2, req `smite` | x1 y1, same gate and group |
| `spinning_smite` | x2 y2, req `smite`+`spin` | x2 y1, same gate and group |
| `lay_on_hands` | y3, req `healing_smite` | y2, unchanged requirement |
| `ketharas_will` | y3, `reqPoints` 12 | y2, unchanged |

Give all three the `ranks` arrays from the rank tables in their `levels` text — cooldowns
accumulate (Healing Smite 100 → 90 → 80 → 70), and "level" in those formulas means the player's
character level.

**Do the deletion and the handler work in one commit.** Removing `smite` before its replacements
are live would leave the warrior with no tier-2 skill at all.

## Two consequences worth surfacing, not silently resolving

- **Lay on Hands requires Healing Smite**, so two of the three choices lock it out entirely. That
  may be exactly the intent — branch identity — but it is a large consequence of a small change.
  Implement as written and flag it in the commit.
- **Spinning Smite no longer requires Spin.** All three share Smite's old gate so the choice is
  symmetric. If it should additionally need Spin, that is a one-line `req` addition.

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
for (let i=0;i<4;i++) cantori.learn('rush');       // open the gate
cantori.learn('raging_smite');
cantori.learn('healing_smite');                     // refused — already committed
cantori.skills()                                    // healing_smite still rank 0
cantori.restart(); cantori.pickClass('warrior');
cantori.skills().healing_smite.rank                 // 0, and selectable again
```
Then use each in a real fight and confirm berserk, the heal, and the radius all land.
