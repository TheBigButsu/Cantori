# A1 — extract `bosses.js`

**Depends on:** nothing. Do this first.
**Touch only:** `bosses.js` (new), `game.js`, `index.html`.
**Read:** `loot.js` (whole, ~2.4k — it is the pattern you are copying), then
the two boss sections — "The Pied Piper" and "The Stone Golem". Look their current
line ranges up in `docs/MAP.md`; do not trust any number written in this brief.
**Do NOT read `game.js` in full.** Grep for a call site if you need one.

## Goal

Move the two boss playbooks out of `game.js` into `bosses.js`, following the module pattern
`loot.js` already established. **No behaviour changes at all** — this is a pure move. It is
first because it is the smallest and least entangled extraction, and because A2–A4 will copy
whatever shape you settle on here.

It also sets up B1, which turns this file into a registry so new bosses stop needing
`game.js` edits.

## The pattern

`loot.js` is a factory that takes its dependencies explicitly:

```js
window.CantoriLoot = function (deps) {
  "use strict";
  const GEAR = deps.GEAR, randInt = deps.randInt;
  function rollItem(key, floor) { … }
  return { rollItem, … };
};
```

and `game.js` wires it up with `const _loot = window.CantoriLoot({ … })` (grep `CantoriLoot`). Copy that
shape exactly: `window.CantoriBosses = function (deps) { … }`.

## What moves

The block runs from the `// ---- The Pied Piper ----` banner to the end of
`tickNodeBlasts`. It is contiguous and contains nothing else — `monsterAct` begins
immediately after it and **stays in `game.js`**. Get the current range from `docs/MAP.md`
(the two boss sections) and confirm the end by grepping `function monsterAct`.

Fourteen functions plus two declarations move, in this order:

| | |
|---|---|
| `const golemShield`, `let pendingNodeBlasts` | the two declarations above `golemAct` |
| Piper | `piperAct` `piperPhaseShift` `piperCastBeam` `piperFireBeam` |
| Golem | `golemAct` `golemResolveWindup` `golemBeginBoulder` `golemFireBoulder` `golemConeTiles` `golemBeginSlam` `golemFireSlam` `golemPhaseShift` `golemNodeDeath` |
| Delayed blast | `tickNodeBlasts` |

Nothing else in that span moves. If a grep turns up a boss function outside it, stop and say so.

Also move the `// ---- The Pied Piper ----` and `// ---- The Stone Golem ----` banners and
their comments. Those comments are good — keep them intact.

## Dependencies to inject

Pass exactly these 33, as a `deps` object:

```
THORN, WALL, attack, canSee, chaseLastSeen, cheb, computeFOV, dead, die,
flash, flashScreen, floatText, inBounds, lineOfSight, log, map, monsterAt,
monsters, patrolStep, player, randInt, sayMonster, snapEntity, snapPlayer,
spawnBurst, spawnNear, spawnProjectile, spawnStreak, stepMonsterTo, turns,
updateHUD, randInt, isThorn
```

Three of these are not plain values and need care:

- **`map`, `monsters`, `dead`, `turns`, `player`** are reassigned in `game.js` (`map = blankGrid(…)`
  on every level generation). If you capture them by value at construction the module will hold a
  stale reference to the *previous* level's map and the game will break in ways the smoke test
  catches on floor 2. Pass **accessor functions** for anything reassigned — `getMap: () => map`,
  `isDead: () => dead` — and leave objects that are only mutated (`player`, `monsters`) as direct
  references. Check each one before deciding: grep for `\bmap =` and `\bdead =`.
- **`die`** ends the run; it must stay the same function identity.

## Exports and rewiring

Return `{ piperAct, golemAct, golemShield, golemNodeDeath, tickNodeBlasts, reset }`.

`reset()` sets `pendingNodeBlasts = []`. Six call sites in `game.js` change:

| Line | Now | Becomes |
|---|---|---|
| 1249 | `pendingNodeBlasts = [];` | `_boss.reset();` |
| 1297 | `pendingNodeBlasts = [];` | `_boss.reset();` |
| 1572 | `golemNodeDeath(target)` | `_boss.golemNodeDeath(target)` |
| 1699 | `golemShield(target)` | `_boss.golemShield(target)` |
| grep `m.type === "piper"` | the dispatch in `monsterAct` | `_boss.piperAct(m)` / `_boss.golemAct(m)` |
| grep `tickNodeBlasts()` | the call in `worldTurn` | `_boss.tickNodeBlasts()` |

Two dev hooks also reference the internals — grep `golemShield:` and `nodeBlasts:`.
Keep both working; add a `nodeBlasts()` export for the latter. The smoke test does not cover
the dev hooks, so check them by grep, not by hope.

## Steps

1. Read `loot.js`, then the range above.
2. Create `bosses.js` with the header comment style `loot.js` uses (what it is, why it's
   separate, how it's constructed).
3. Move the code. Change nothing inside the function bodies except identifiers that now come
   from `deps`.
4. Wire it in `game.js` near the other module construction. It must be constructed **after** the
   functions it depends on are defined.
5. Rewire the six call sites and two dev hooks.
6. Add `<script src="./bosses.js?v=NN"></script>` to `index.html` **before** `game.js`, and bump
   every `?v=` (rule 4).
7. `python3 tools/make_map.py` — the line numbers all moved.

## Done when

- `bosses.js` exists, `game.js` is ~180 lines shorter, no boss function is defined in `game.js`.
- No behaviour changed. This is the whole point.

## Verify

```sh
node tests/smoke.js
```

That covers generation and the turn loop but **only lightly exercises the bosses** — it runs
25 turns per floor, which may not trigger a phase shift. Also check by hand:

```js
// browser console, http://localhost:8000
cantori.pickClass('warrior');
for (let i=0;i<4;i++) cantori.descend();   // depth 5, the Piper
cantori.peek().mlist                        // the boss is there
for (let i=0;i<40;i++) cantori.tick();      // it acts, beams, phases — no exceptions
```

Repeat at depth 10 for the Golem, and confirm `cantori.golemShield()` still returns a number
and drops as you kill nodes.

## If this goes wrong

If threading `deps` turns out to need more than ~40 entries or the accessor-function problem
spreads, **stop and say so in the commit message** rather than forcing it. That result would
mean the closure is too entangled for a clean split, and A2–A4 need rethinking — which is
exactly why this packet is first.
