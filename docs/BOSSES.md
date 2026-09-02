# Authoring a boss

A boss is a `data.js` row plus, if it needs bespoke behaviour, one entry in the `PLAYBOOKS`
registry in `bosses.js`. No `game.js` edit is required either way — `game.js` never checks a
boss's `type`; it only calls the generic hooks described below.

## The `data.js` row

```json
"bosses": {
  "golem": {
    "name": "Stone Golem",
    "hp": 400,
    "atkMin": 1,
    "atkMax": 25
  }
}
```

`name`, `hp`, `atkMin`, `atkMax` are the minimum a boss needs — without them `spawnBoss` has no
name to announce and no damage to roll on a plain hit. But `makeBoss` now spreads the **whole**
row onto the spawned monster (the same way `makeMonster` copies a `VERMIN` template), so anything
else you put on the row survives to the live instance and is readable from a playbook: `speed`,
`acc`, `eva`, `ranged`, `range`, `flying`, or any ad-hoc field a playbook wants (e.g. a phase
threshold, an add's type). Assign the row to a biome's `"boss"` key (and optionally `"bossCount"`
for more than one) the same way `piper` / `golem` / `mummy` already are.

## The playbook registry

In `bosses.js`, `PLAYBOOKS` is a plain object keyed by the boss's `data.js` key:

```js
const PLAYBOOKS = {
  piper: { act: piperAct },
  golem: { act: golemAct, onKill: golemNodeDeath, damageIn: golemDamageIn, tick: tickNodeBlasts },
  mummy: { act: mummyAct },   // placeholder — see below
};
```

A boss with **no** entry (or an entry missing a field) just falls through to the default: the
same chase-and-hit AI every regular monster runs. Every field is optional and independent:

| Field | Called from `game.js` | For |
|---|---|---|
| `act(m)` | `monsterAct`, instead of the default AI, on the boss's own turn | the whole playbook — movement, attacks, phases |
| `tick()` | `worldTurn`, once per world turn, unconditionally | delayed effects (the Golem's node blasts) — write it so it's a cheap no-op when nothing is pending |
| `onKill(target)` | `killMonster`, whenever **any** monster dies (not just the boss) | reacting to an add dying — `target` is whatever died |
| `damageIn(target, dmg)` | `attack`, when the boss takes a hit; must return the (possibly modified) damage | shields, resistances |
| `onSpawn(m)` | `spawnBoss`, once, right after the boss is placed | phase state, arena setup, an opening line |

`onKill` and `tick` are dispatched to **every live boss on the floor**, not just the one whose
turn it is — that's how the Golem's `onKill: golemNodeDeath` fires when a Healing Node (a regular
monster it summoned, not the golem itself) dies. `damageIn`/`onSpawn`/`act` are looked up by the
acting/target monster's own `type`.

Get an entry with `_boss.playbookFor(type)` — returns the `PLAYBOOKS` object or `null`. You
shouldn't normally need this directly; the four wired call sites (`act` via `monsterAct`,
`damageIn` via `attack`, `onKill` via `killMonster`, `tick` via `worldTurn`, `onSpawn` via
`spawnBoss`) cover everything.

### The placeholder pattern

`mummy: { act: mummyAct }` where `mummyAct` is one line:

```js
function mummyAct(m) { normalAct(m); }
```

`normalAct` is `game.js`'s `defaultAct` — the same chase-and-hit path every non-boss monster
runs — passed into `bosses.js` as a dependency. This is the minimum viable playbook: a boss with
no special mechanics yet still needs *an* entry only if you want to prove the wiring, or a hook
into which to grow real behaviour later. A boss can also have **no** entry at all and get the
same default AI for free — `mummyAct` exists here purely to demonstrate the registry dispatches
correctly, not because it's required.

## Tools already available to a playbook

Don't rebuild any of these — they're passed into `bosses.js` as dependencies and used throughout
`piperAct`/`golemAct` already:

- **`sayMonster(m, text, color)`** — a speech bubble over the monster for a couple seconds (a taunt).
- **`spawnProjectile(x0, y0, x1, y1, color)`** / **`spawnStreak(x0, y0, x1, y1, color, dur)`** — a
  bolt or a motion streak between two tiles. Purely visual.
- **`spawnBurst(x, y, color)`** — an expanding ring + sparks at a tile (impacts, teleports).
- **`flashScreen(color, dur)`** — a brief full-view colour wash. Use it on anything that should
  read as "notice this NOW" (a telegraph, a big hit landing).
- **`floatText(x, y, text, color)`** — a floating combat-text glyph at a tile. Also doubles as a
  telegraph marker (`floatText(x, y, "⚠", color)` on every tile about to be hit).
- **`m.windup = { kind, turns, ...whateverYouNeed }`** — the Golem's two-turn-telegraph pattern:
  set it, decrement `turns` each of the boss's own turns while it's set (see `golemResolveWindup`),
  and resolve the attack when it hits 0. While `m.windup` is set the boss takes no other action —
  check it first in your `act`.
- **`m.phased`** — a one-shot flag for a threshold effect (both existing bosses use "once below
  50% HP"); set it the first time the condition is true so it doesn't refire every turn after.
  Nothing in the engine reads it — it's yours.
- **`m.dots`** — the burn/poison array; `addDot`/`addPoison` (in `game.js`, not exposed to
  `bosses.js` — a boss doesn't dot itself) tick it automatically once per turn before `monsterAct`
  runs, independent of whatever the boss's own `act` does that turn.
- **`m.stun`** — turns of stun remaining; also handled generically before `act` runs (a stunned
  boss's turn is skipped entirely, same as any monster).
- **`lineOfSight(x0, y0, x1, y1)`** — a clear line between two tiles (walls block it).
- **`cheb(ax, ay, bx, by)`** — Chebyshev (8-direction) distance, the distance metric the whole
  combat/movement system uses.
- **`canSee(m)`**, **`stepMonsterTo(m, tx, ty)`**, **`chaseLastSeen(m)`**, **`patrolStep(m)`**,
  **`attack(attacker, target)`** — the building blocks `normalAct`/`golemAct`/`piperAct` all use to
  approach, chase, wander and hit; reuse them rather than reimplementing movement.
- **`summon(type, x, y, opts)`** (`bosses.js`-only, not a `game.js` dependency) — places a monster
  near `(x, y)` the same way `spawnNear` does and additionally flags it `summoned: true` (visible
  in `peek().mlist`). `opts: { radius, count }`, both optional (default `3`, `1`).

## Worked example

A boss that summons two adds and telegraphs a slam once it drops below half HP — nothing here
that `golemAct` doesn't already do at greater length; this is the same shape, stripped down.

```js
function directorAct(m) {
  if (m.windup) { directorResolveSlam(m); return; }         // mid-telegraph: nothing else this turn
  const see = canSee(m);
  if (see) { m.aware = true; m.lastSeen = { x: player.x, y: player.y }; }
  if (!m.phased && m.hp <= m.maxHp * 0.5) {                  // once, crossing 50%
    m.phased = true;
    summon("cultist", m.x, m.y, { radius: 4, count: 2 });
    sayMonster(m, "Rise!", "#c9a24a");
    log("The Director calls two cultists to its side!", "hurt");
    return;
  }
  const d = cheb(m.x, m.y, player.x, player.y);
  if (see && d >= 2 && d <= 4 && Math.random() < 0.4) {      // telegraph a slam
    m.windup = { turns: 2 };
    floatText(m.x, m.y, "⚠", "#e0a848");
    sayMonster(m, "Hold still.", "#e0a848");
    return;
  }
  if (d === 1) { attack(m, player); return; }
  if (see) { stepMonsterTo(m, player.x, player.y); return; }
  if (m.lastSeen) { chaseLastSeen(m); return; }
  patrolStep(m);
}
function directorResolveSlam(m) {
  m.windup.turns--;
  if (m.windup.turns > 0) return;
  m.windup = null;
  flashScreen("#5a3e1e", 300);
  if (cheb(m.x, m.y, player.x, player.y) <= 1) {
    const dmg = randInt(15, 25);
    player.hp -= dmg; flash(player); floatText(player.x, player.y, "-" + dmg, "#ff5a5a");
    log("The Director's slam catches you! (-" + dmg + ")", "hurt");
    updateHUD();
    if (player.hp <= 0) die();
  } else {
    log("You dodge clear of the slam.", "hit");
  }
}
```

Register it: `director: { act: directorAct }`. That's the whole integration — a `data.js` row for
`director` (name/hp/atkMin/atkMax), assign it to a biome's `"boss"` key, done.

For a fuller reference — windups with two different resolutions, a phase shift with knockback,
a shield driven by living adds, and a delayed-effect queue ticked from `worldTurn` — read
`golemAct` and its neighbours in `bosses.js`.
