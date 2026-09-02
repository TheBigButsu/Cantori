# B4 — the `song` skill kind (Bard)

**Depends on:** nothing.
**Touch only:** `game.js` (Skills + Monster turns + HUD), `data.js`, `index.html`.
**Read:** the "Skills" section (line range in `docs/MAP.md`), then grep `fleeing`, `berserk`, `pullZone`,
`hasteBuff`.
**Do NOT read `game.js` in full.**

## Goal

One new kind — `song` — a **sustained aura** rather than a one-shot cast. This is the only
genuinely new mechanic among the three class packets: everything else is a fire-and-forget
skill, and a song stays on, drains MP each turn, and ends when you run dry or switch.

Framework only. The human authors which songs exist and what they do.

## The mechanic

- One song active at a time: `player.song = { key, rank }`.
- Using a `song` skill toggles it: same key again turns it off; a different key switches.
- Each world turn, drain `rank.upkeep` MP. At zero MP the song **stops** with a log line — do
  not let MP go negative and do not silently keep the effect running.
- No cooldown while running; apply the cooldown when it *stops*, so it can't be spam-toggled.
- Effects apply to aware monsters within `rank.radius`, recomputed each turn (monsters move in
  and out of range).

## Reuse the monster states that already exist

Three of the four effects need no new state at all — grep each and set it the same way the
existing boons do:

| `rank.effect` | Implementation |
|---|---|
| `"fear"` | set `m.fleeing` on monsters in radius (Maelon's Dread already does this) |
| `"discord"` | set `m.berserk` (Kethara's Anger already does this) |
| `"valor"` | self-buff: feed `rank.acc` / `rank.dmg` through `passiveMod`, the path class passives already use |
| `"charm"` | **the one new state** — see below |

Setting a duration of 2 turns and refreshing it each turn is the cheapest way to make "while in
the aura" work with states that are turn-counted — the effect then lapses naturally one turn
after the monster leaves the radius.

## Charm — the new state

`m.charmed > 0` means the monster fights *for* you: in `monsterAct`, it targets the nearest
other monster instead of the player, and will not attack the player. `monsterVsMonster` already
exists — grep it; `berserk` already uses it. Charm differs from berserk only in never choosing
the player as a target.

Give it a visible tell (a heart floater on the turn it takes hold, or a tint) — an effect the
player can't see is an effect they won't use.

## HUD

The active song must be visible — the hotbar button for a running song should read as *on*
(the hotbar already renders cooldowns; grep `updateHotbar`). Without this the player cannot
tell a song is draining their MP.

## Rank shape

```json
{ "effect": "fear", "radius": 4, "upkeep": 1, "turns": 2, "acc": 2, "dmg": 1 }
```

## Done when

- A `song` cell toggles on and off, drains MP per turn, and stops cleanly at 0 MP.
- Switching songs stops the previous one — never two at once.
- Charmed monsters attack other monsters and never the player.
- The song clears on descend? **No — it persists across floors**, but it must clear on death and
  new run (`applyClass`).

## Verify

```sh
node tests/smoke.js
```
```js
cantori.pickClass('monk'); cantori.grant(5); cantori.learn('<key>');
cantori.setMp(20); cantori.doSkill('<key>');
for (let i=0;i<10;i++) cantori.tick();
cantori.peek().mp                     // drained by upkeep each turn
cantori.peek().mlist                  // nearby monsters show fleeing/berserk
```
Run MP to zero and confirm the song stops with a log line rather than going negative.
