# B1 — a boss playbook registry

**Depends on:** A1 (`bosses.js` must exist).
**Touch only:** `bosses.js`, `game.js`, `data.js`, `docs/BOSSES.md` (new).
**Read:** `bosses.js` (whole — it's small after A1), the "Monster & boss factories" section
(line range in `docs/MAP.md`), and grep `monsterAct` for the dispatch lines.
**Do NOT read `game.js` in full.**

## Goal

Right now adding a boss means editing `monsterAct` in `game.js` (`if (m.type === "piper") …`),
and `makeBoss` throws away every field of the data row except `name`, `hp`, `atkMin`, `atkMax`.
That makes each new boss an engine change.

After this packet, a new boss is: **a `data.js` row + one playbook object in `bosses.js`.** No
`game.js` edits. This is what lets the Mummy, the Cultists and the Demi-God be authored as
content rather than surgery.

## Two problems to fix

**1. `makeBoss` drops the data row.** Compare (grep `function makeBoss`):

```js
function makeMonster(type, x, y) {
  // copies the whole template so ability flags carry over
  return Object.assign({}, VERMIN[type], { x, y, type, boss: false, … });
}
function makeBoss(key, x, y) {
  const b = DATA.bosses[key];
  return { x, y, type: key, boss: true, name: b.name, … };   // ← everything else lost
}
```

Make `makeBoss` spread the whole row the way `makeMonster` does, so authored fields (`speed`,
`acc`, `eva`, `ranged`, `range`, and anything a playbook wants to read) survive. Keep the
explicit overrides that follow — `boss: true`, `glyph`, `color`, `level: depth`, `maxHp`.

**2. Dispatch is hardcoded.** Replace the `if (m.type === …)` chain in `monsterAct` with one
registry lookup.

## The registry

In `bosses.js`, keep playbooks in a plain object keyed by the `data.js` boss key:

```js
const PLAYBOOKS = {
  piper: { act: piperAct },
  golem: { act: golemAct, onKill: golemNodeDeath, damageIn: golemShield, tick: tickNodeBlasts },
};
```

Each field is optional, and each has one job:

| Field | Called | For |
|---|---|---|
| `act(m)` | instead of normal monster AI, on the boss's turn | the playbook |
| `tick()` | once per world turn while the boss floor is live | delayed effects (the node blasts) |
| `onKill(target)` | when any monster dies | reacting to adds dying |
| `damageIn(target, dmg)` | when the boss takes damage; returns the modified damage | shields |
| `onSpawn(m)` | when the boss is placed | phase state, adds, arena setup |

Export `playbookFor(type)` returning the entry or `null`. Then in `game.js`:

- `monsterAct` — one lookup: `const pb = _boss.playbookFor(m.type); if (pb && pb.act) { pb.act(m); return; }`,
  replacing both hardcoded branches. Keep the `healing_node` passive check as it is.
- `attack` (grep `golemShield(target)`) — `dmg = _boss.damageIn(target, dmg)`, which returns `dmg` unchanged when no
  playbook applies. Delete the `if (target.type === "golem")` special case.
- `killMonster` (grep `golemNodeDeath(target)`) — `_boss.onKill(target)` replacing the `healing_node` special case.
- `worldTurn` (grep `tickNodeBlasts()`) — `_boss.tick()` replacing `tickNodeBlasts()`.

`golemShield` keeps its current signature for the dev hook; `damageIn` wraps it.

## Adds: `summoned` monsters

Both new-boss designs need adds. `makeMonster` already exists and `peek().mlist` already reports
a `summoned` flag, so expose a small helper from `bosses.js` — `summon(type, x, y, opts)` — that
places a monster near a tile and marks it `summoned: true`. Reuse `spawnNear` if it does this
already; grep before writing a second one.

## Write `docs/BOSSES.md`

Short — one page. It is the reference the *human* uses when authoring the next boss:

- the `data.js → bosses` row shape, including which fields now survive `makeBoss`
- the playbook interface table above
- the tools a playbook can call, which already exist and should not be rebuilt:
  `sayMonster` (taunts), `spawnProjectile` / `spawnBurst` / `spawnStreak` / `flashScreen`
  (telegraphs and impacts), `floatText`, `m.windup` (the Golem's two-turn telegraph — copy it),
  `m.phased` (one-shot phase flag), `m.dots` (burn/poison), `m.stun`, `lineOfSight`, `cheb`
- a worked 30-line example: a boss that summons at 50% HP and telegraphs a slam

Point at `golemAct` as the reference implementation — it does windup, phase shift, adds,
shields and two attack patterns in ~150 lines.

## Done when

- `PLAYBOOKS` drives all dispatch; `game.js` contains no boss-specific `if (m.type === …)`.
- `makeBoss` preserves the full `data.js` row.
- Adding a boss requires no `game.js` edit — demonstrate it by giving `mummy` a one-line
  placeholder playbook (`act` that just calls the normal chase-and-hit path) and confirming it
  is dispatched.
- Piper and Golem fight **exactly** as before.

## Verify

```sh
node tests/smoke.js
```
Then by hand, for each of depth 5 and 10:
```js
cantori.pickClass('warrior');
for (let i=0;i<4;i++) cantori.descend();
for (let i=0;i<60;i++) cantori.tick();     // no exceptions; boss acts and phases
cantori.golemShield()                       // still a number at depth 10
```
Confirm a boss row edited in `editor.html` (e.g. giving the Mummy `"speed": 1.5`) now actually
reaches the spawned monster — `cantori.peek().mlist` should show it.
