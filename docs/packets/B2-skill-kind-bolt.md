# B2 — the `bolt` skill kind (Mage)

**Depends on:** nothing (A-track independent).
**Touch only:** `game.js` (Skills section), `data.js`, `index.html` (cache-buster).
**Read:** the "Skills" section (line range in `docs/MAP.md`), then grep `beginTargetedSkill` and
`executeThrowSkill` — copy how an existing tap-a-target skill resolves.
**Do NOT read `game.js` in full.**

## Goal

Add one new skill `kind` — `bolt` — a tap-a-target ranged attack that costs MP and scales on
INT. This is the framework the human needs to author the Mage's skill tree in `editor.html`;
this packet does **not** design the Mage's skills or balance them.

The MP pool already exists (`player.mp`, `computeMaxMp`, `mpRegenTurns`/`intRegen` per class,
shown in the vitals bar) and currently has nothing to spend it on. `bolt` is the first spender.

## Where it goes

`useSkill` dispatches on `d.kind` (grep `d.kind === "rush"`). Targeted skills all route through
`beginTargetedSkill(key)` — add `"bolt"` to that list, then handle it in the executor
that `beginTargetedSkill` eventually calls (grep for where `wallcast`/`eyecast` resolve).

## Behaviour

On confirm, with a target tile:

1. **Range and line of sight.** Reject beyond `rank.range` or without `lineOfSight(player.x,
   player.y, tx, ty)`, with a log line — do not consume MP or a turn.
2. **MP.** Reject if `player.mp < rank.mp`, log it, no turn spent. Otherwise deduct and
   `updateHUD()`.
3. **Damage.** `randInt(rank.dmgMin, rank.dmgMax) + Math.floor(eff("INT") * (rank.intScale || 0))`.
   Route it through the *existing* damage path so armour, crits, DOTs, enchant procs, kill
   handling and XP all behave — grep how `executeSpin` applies damage and reuse that, rather
   than writing `target.hp -= dmg`.
4. **Visuals.** `spawnProjectile(player.x, player.y, tx, ty, rank.color)` then `spawnBurst` on
   impact. Both already exist; do not write new effects.
5. **Optional DOT.** If `rank.burn` is set, push onto `target.dots` in the shape the existing
   fire enchant uses — grep `dots.push` and copy it exactly, including `tag`, `icon`, `color`.
6. **Cost a turn** at the same cost an attack does (`attackCost()`), and set the cooldown.

Missing (empty tile, no monster) still spends MP and the turn — a missed spell is a real cost.

## Rank shape

Ranks are authored per skill-tree cell in `data.js`. Support:

```json
{ "range": 5, "mp": 4, "dmgMin": 3, "dmgMax": 7, "intScale": 0.5,
  "burn": { "dmg": 2, "rounds": 3 }, "color": "#7fd4ff" }
```

Every field optional with a sane default, so a half-filled editor cell still works.

## Done when

- A skill-tree cell with `"kind": "bolt"` and a `ranks` array is learnable, appears on the
  hotbar, targets, fires, costs MP, respects cooldown, and kills things properly (XP, drops,
  boss `onKill` all fire).
- No MP → clear log line, no turn lost.
- The other kinds are untouched.

## Verify

```sh
node tests/smoke.js
```
```js
// add a temporary bolt cell to a class tree via editor.html Playtest, then:
cantori.pickClass('adept'); cantori.grant(5); cantori.learn('<key>');
cantori.setMp(100); cantori.doSkill('<key>');   // then tap a monster
cantori.peek().mp                                // dropped by rank.mp
```
Confirm a kill via bolt grants XP and drops loot exactly as a melee kill does.
