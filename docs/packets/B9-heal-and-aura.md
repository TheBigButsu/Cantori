# B9 — Lay on Hands, and Kethara's Will

**Depends on:** nothing (B8 is independent; both touch the Skills section, so don't run them
in parallel).
**Touch only:** `game.js` (Skills section), `data.js`, `editor.js`, `index.html`.
**Read:** the "Skills" section (line range in `docs/MAP.md`) — `useSkill`, `passiveMod` — and
grep `armorFlat` and `stoneSkin`.
**Do NOT read `game.js` in full.**

## Goal

Make the last two authored warrior skills real. They carry rank prose but no `ranks` array and
no working `kind`, so today they draw in the tree and do nothing.

One needs a new kind. The other needs no new kind at all — which is worth knowing before you
start writing one.

## 1. Kethara's Will — a passive, not a new kind

`passiveMod(field)` already sums any named field across every active passive skill. So the
self-protection half of this aura is: `kind: "passive"`, `mit` in each rank, and **one line**
folding `passiveMod("mit")` into `armorFlat()` so it composes with armour, VIT reduction and
stone skin rather than bypassing them.

| rank | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| damage taken | −5% | −10% | −15% | −20% |
| radius | 1 | 2 | 3 | 4 |

`mit` in `armorFlat` is flat mitigation, while the authored text is a percentage — use whichever
the existing mitigation path expects and keep the *displayed* text matching what the code does.
If flat and percent genuinely can't be reconciled, implement percent through the same route
`RES` already uses (grep the incoming-damage formula) and say so in the commit.

**The radius does nothing yet, and that is expected.** It protects "allies and summons", and
neither exists until B4's charm or B5's `summoner` land. Implement the self half now; leave the
radius in the data and a one-line comment saying what will read it. Do not build an aura system
for an empty set.

## 2. Lay on Hands — a `heal` kind

Self-cast, no target. Add `"heal"` to the `useSkill` dispatch (grep `d.kind === "rush"`).

**Its prerequisite is already settled and needs no work from you:** it is gated on character
level 15 (`minLevel: 15` on the node), not on Healing Smite. The engine reads node-level
`minLevel` in `prereqsMet` and the editor can author it — leave `req` empty.

- Heals `rank.formula` — rank 1 `VIT`, rank 2 `VIT + STR`, rank 3 `VIT + STR + playerLevel`,
  rank 4 `(VIT + STR) + playerLevel × 2`. Read stats through `eff()`, not `player.stats`, so
  gear and boons count.
- **Overheal shortens the cooldown**: every point above `maxHp` takes one turn off. That is the
  whole character of the skill — heal early and it is nearly free, heal at death's door and you
  wait the full 200.
- 200 turn cooldown, 15 MP. Reject with a log line and no turn spent if MP is short.
- Costs a turn, and shows a green floater and the heal in the log.

Express the formula as rank fields (`vit`, `str`, `lvl` multipliers) rather than a parsed string,
so it stays editable in `editor.html`.

## Both

- Fill in the `ranks` arrays from the text already in each node's `levels` — the numbers are
  there, the prose was written to match.
- `treeSkills` builds each skill from an explicit field list. Any new field you add must be named
  there too or it is silently dropped between `data.js` and the engine.
- Teach `editor.js` any new field, same commit (rule 2).

## Done when

- Both are learnable, appear on the hotbar (Kethara's Will won't — passives have no button, which
  is correct), and do what their rank text says.
- Kethara's Will measurably reduces damage taken; the reduction shows in the character screen
  next to the other mitigation.
- Lay on Hands' cooldown is visibly shorter when cast at high HP than at low.

## Verify

```sh
node tests/smoke.js
```
```js
cantori.pickClass('warrior'); cantori.grant(30);
for (let i=0;i<4;i++) cantori.learn('rush');
cantori.learn('lay_on_hands');         // refused below character level 15
for (let i=0;i<40 && cantori.peek().level<15;i++) cantori.addXp(3000);
cantori.learn('lay_on_hands');
cantori.setMp(100); cantori.hurt(15); cantori.doSkill('lay_on_hands');
cantori.peek().hp                      // healed
cantori.skills().lay_on_hands.cd       // < 200 if it overhealed
```
For the aura: note `peek().armorDef`, learn Kethara's Will, and confirm it rises.
