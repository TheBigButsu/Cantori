# B6 — monster behaviour flags: `webber`, `drain`, `splitter`, `ambusher`

**Depends on:** B5 (same section; do them in order to avoid conflicting edits).
**Touch only:** `game.js` (Monster turns section), `data.js`, `index.html`.
**Read:** the "Monster turns" section (line range in `docs/MAP.md`). Grep `m.stun`, `dots.push`, `aware`,
`makeMonster`.
**Do NOT read `game.js` in full.**

## Goal

Four more data-driven behaviour flags. Same contract as B5: absent means today's behaviour,
each takes an object, each is added to `editor.js` in the same commit.

Read B5's brief first — the ordering rule inside `monsterAct` (after `fleeing`/`berserk`,
before plain approach; `return` when you act) applies here too.

## The four flags

**`web: { every, turns, range }`** — immobilizes rather than damages.
- On a clear line to the player within `range`, apply `player.stun` for `turns` — the stun
  mechanism already exists (the wall-slam uses it) so wasted turns, the "zzz" floater and the
  turn accounting all work already. Grep `player.stun` and reuse it; do not invent a second
  immobilize.
- Telegraph with a projectile. Respect the cooldown — a permanent stun-lock is not a fight.
  Enforce a floor on it: never re-web while the player is still stunned.

**`drain: { pct }`** — heals itself for a share of melee damage dealt.
- Hook the existing melee resolution rather than adding a second attack path: after damage
  lands, `m.hp = Math.min(m.maxHp, m.hp + Math.ceil(dmg * pct))`, with a green floater so it
  is legible.
- Cap at `maxHp`. A drainer must never exceed its own maximum.

**`split: { into, hp, max, count }`** — divides when hurt.
- On taking damage and surviving, spawn `count` copies (`into` defaults to its own type) at
  `hp` HP nearby.
- **This is the dangerous one.** Track generation depth on each spawn and refuse to split past
  `max` generations, and refuse when the level is already crowded. An unbounded splitter fills
  the floor and hangs the turn loop — the smoke test's AI churn will catch it, so run it.
- Splits must not inherit `split` beyond the generation cap.

**`ambush: true`** — starts unaware and stays hidden until you're close.
- The surprise system already exists: a monster that has never seen you takes a guaranteed
  1.5× hit when *you* strike first. `ambush` is the inverse — it holds still (no patrol
  wandering, so it doesn't blunder into view) until the player is within `range`, then wakes
  and attacks.
- Do not render it invisible; that is a different feature and needs renderer work.

## Rules

- No existing monster changes behaviour. That is the bar.
- Teach `editor.js` all four fields in this commit.
- Every flag that acts must `return` — no acting *and* stepping in one turn.

## Done when

- All four work, tunable from the editor, no regressions.
- A splitter provably terminates: spawn one, hit it repeatedly, confirm the population stops
  growing.
- The web flag cannot chain-stun the player indefinitely.

## Verify

```sh
node tests/smoke.js --turns 60
```
The longer AI churn is the point here — splitters and summoners fail slowly.
```js
cantori.spawnAt('rat', px+2, py, 40, 1);
for (let i=0;i<80;i++) cantori.tick();
cantori.peek().monsters      // bounded, not climbing
```
