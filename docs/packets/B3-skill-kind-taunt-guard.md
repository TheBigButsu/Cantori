# B3 — the `taunt` and `guard` skill kinds (Tank)

**Depends on:** nothing.
**Touch only:** `game.js` (Skills + Monster turns sections), `data.js`, `index.html`.
**Read:** the "Skills" section (line range in `docs/MAP.md`), then grep `stoneSkin` (the timed-buff
pattern you are copying) and `pullZone` (the "override monster targeting" pattern).
**Do NOT read `game.js` in full.**

## Goal

Two skill kinds that give the Tank class a defensive identity. Framework only — the human
authors the actual tree.

Both have close precedents already in the code. **Copy them rather than inventing new
machinery**: `stoneSkin` is an existing timed self-buff with a turn counter ticked in
`worldTurn`, and `pullZone` is an existing mechanism that overrides where monsters path.

## `guard` — timed damage reduction

Self-cast, no target. Follow `stoneSkin` exactly (grep `stoneSkinActive` for the accessors, and the
tick in `worldTurn`):

- `player.guard = { turns: rank.turns, mit: rank.mit }` on cast.
- Decrement in `worldTurn` alongside `stoneSkin`; log when it lapses.
- Feed `rank.mit` into the existing mitigation path — grep `armorFlat` and add it there so it
  composes with armour, VIT reduction and stone skin instead of bypassing them.
- Costs MP if `rank.mp` is set.
- Show it wherever `stoneSkin` is surfaced (character screen / examine), so the player can see
  it is running.

## `taunt` — forced aggro

Self-cast, radius-based. `pullZone` shows the pattern for bending monster behaviour for N turns.

- `player.taunt = { turns: rank.turns, radius: rank.radius }`.
- In `monsterAct`, an aware monster within `radius` targets the player: it approaches and
  attacks even if `berserk` would have sent it elsewhere. Place the check **after** the
  `fleeing` branch (a terrified monster still flees — fear beats taunt) and **before**
  `berserk`.
- While taunted, a monster that would normally keep its distance (`ranged`) still closes. That
  is the point of the ability.
- Give it a visible tell — `floatText(m.x, m.y, "!", …)` on the turn it takes hold, once per
  monster, not every turn.

## Rank shapes

```json
{ "turns": 8, "mit": 4, "mp": 3 }                    // guard
{ "turns": 6, "radius": 4, "mp": 3 }                 // taunt
```

## Done when

- Both kinds are learnable, hotbar-visible, cooldown-respecting.
- `guard` measurably reduces incoming damage and expires on schedule.
- Taunted monsters converge on the player; fear still overrides taunt.
- Both clear on death/new run — check `applyClass`, which resets `stoneSkin` and friends; add
  yours there or they leak across runs.

## Verify

```sh
node tests/smoke.js
```
```js
cantori.pickClass('warrior'); cantori.grant(5); cantori.learn('<key>');
cantori.doSkill('<guard>'); cantori.peek()          // guard state present
cantori.spawnAt('rat', px+3, py, 20, 1);
cantori.doSkill('<taunt>');
for (let i=0;i<6;i++) cantori.tick();                // the rat closes in
```
Then `cantori.restart()` and confirm neither buff survives into the new run.
