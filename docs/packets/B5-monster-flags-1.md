# B5 — monster behaviour flags: `summoner`, `healer`, `blinker`

**Depends on:** nothing.
**Touch only:** `game.js` (Monster turns section), `data.js`, `index.html`.
**Read:** `Read(game.js, offset=2753, limit=140)` — that's `monsterAct`, the whole surface you
are extending. Grep `spawnNear`, `spawnBurst`, `flashScreen`.
**Do NOT read `game.js` in full.**

## Goal

Three new **data-driven behaviour flags**, so the human can author monsters for biomes 2–5 in
`editor.html` without touching code. Today the only behaviours are melee, `ranged` + `range`,
and `charge` — which is why every biome fights the same.

This packet adds no monsters. It adds the flags; the rosters come later as content.

## How `monsterAct` is structured

Read it before writing. The order of checks matters and is deliberate: DOTs → stun → boss
playbook → fleeing → berserk → see-player → adjacent-attack → ranged → charge → pull → approach
→ chase last seen → patrol.

**Put every new behaviour after the `fleeing`/`berserk` branches and before the plain approach.**
A monster that is terrified must not stop to cast. Each new branch `return`s when it acts —
acting *and* moving in one turn is a bug.

## The three flags

**`summon: { type, max, every, count }`** — calls in adds.
- Only when it can see the player (`canSee(m)`), and only every `every` turns (track a
  per-monster counter, e.g. `m.summonCd`, decremented in its own turn — do not use a global).
- Never exceed `max` live summons *from this monster*: tag each add `summoned: true` and count
  them. `peek().mlist` already reports `summoned`, so the smoke test can see them.
- Place adds with the existing `spawnNear`; if a spot can't be found, skip the turn quietly.
- Telegraph it: `sayMonster` or a `spawnBurst` — an add that appears from nowhere reads as a bug.
- **Guard against runaway spawning**: a summoner that summons summoners will exhaust the level.
  Never let an add inherit a `summon` flag — strip it when placing.

**`heal: { amount, range, every }`** — mends other monsters.
- Heals the most-wounded monster within `range` (never itself, never above `maxHp`).
- Skip the turn entirely if nothing nearby is damaged — a healer with nothing to heal should
  approach or patrol, not stall.
- Show it: green `floatText` on the target, and a `spawnProjectile` from healer to target.

**`blink: { range, every, minDist }`** — teleports.
- When the player is closer than `minDist`, jump to a random passable, unoccupied tile within
  `range` that is not adjacent to the player. Use the existing `nearestFreeFloor` /
  `passable` helpers; never place a monster into a wall, a thorn, or another monster.
- `spawnBurst` at both ends and `snapEntity` so it doesn't tween across the map.
- Blinking is its whole turn.

## Rules

- Every flag is optional and absent-by-default: an existing monster with none of them behaves
  **exactly** as it does today. This is the acceptance bar.
- All three take an object, not a bare `true`, so the editor can tune them per monster.
- Add them to `editor.js`'s monster table in this same commit (rule 2) or the editor will drop
  them the next time content is saved.

## Done when

- The three flags work, are tunable from `editor.html`, and no existing monster changes
  behaviour.
- A summoner cannot exceed `max`, and its adds cannot summon.
- `node tests/smoke.js` passes — including the AI churn, which is what catches "acts and moves
  in the same turn" and infinite-summon bugs.

## Verify

```sh
node tests/smoke.js
```
```js
// give the rat a flag via editor.html Playtest, then:
cantori.spawnAt('rat', px+4, py, 20, 1);
cantori.forceAware(0, px, py);
for (let i=0;i<40;i++) cantori.tick();
cantori.peek().mlist.filter(m => m.summoned).length   // <= max, and stops growing
```
