# C2 — put water, grass and rubble on the floor

**Depends on:** C1 (the `TILE` table and its predicates must exist).
**Touch only:** `game.js` (Dungeon generation section), `data.js`, `editor.js`, `index.html`,
`tests/smoke.js`.
**Read:** the "Dungeon generation" section (line range in `docs/MAP.md`), and grep
`makeThornVaults` — it is the existing terrain-carving routine and the pattern to follow.
**Do NOT read `game.js` in full.**

## Goal

Every one of the 25 floors runs the same recipe: rooms, winding corridors, doors, a thorn vault,
trees, torches. Only the wall and floor sprites change between biomes, which is why floor 22
plays exactly like floor 3.

This packet makes the generator paint **biome-specific terrain** with the tiles C1 declared:
water and reed beds in the Forest and the Lake, rubble fields in the Caves. Chasms are C3 —
they change how a floor is *traversed* and deserve their own packet.

## Where it hooks

Inside `generateLevel`, terrain painting goes **after** `thinCorridors(rooms)` and **before**
`placeDoors(rooms)`: the room graph and corridors exist by then, but doors, the exit, monsters,
items, trees and torches have not been placed, so nothing has to be moved out of the way.

Immediately after painting, call `fixOpenCorners(rooms)` and then **re-prove connectivity** — see
below. `generateLevel` already re-sweeps corners after `placeTrees` for exactly this reason;
follow that precedent.

## The painters

Per-biome, driven from `data.js → biomes` so it is tunable in the editor and different per biome
rather than hardcoded:

```json
"terrain": { "water": { "pools": [1, 3], "size": [4, 12] }, "grass": { "patches": [2, 5] } }
```

A biome with no `terrain` block paints nothing and generates exactly as it does today — that is
the safety net, and it means the Crypt and Town are untouched by this packet.

- **Water** (Forest, Lake) — a few organic pools inside rooms, or a stream following a corridor.
  Costs double to cross (`costMult`), so it is a real choice rather than decoration.
- **Grass** (Forest) — patches that conceal what stands in them. `conceals` is declared in C1;
  implement it here as monsters in grass not being drawn until adjacent or attacking. Keep it
  simple: if that turns out to tangle with FOV, paint the grass and leave concealment to a
  follow-up, and say so in the commit.
- **Rubble** (Caves) — scattered debris, also `costMult`.

Keep them **sparse**. The goal is floors that read as places, not obstacle courses; a room that
is half water is a room the player walks around, not through.

## The rule that matters

**Never paint terrain that severs the level.** Water is passable so it cannot, but grass and
rubble must never land on the only tile joining two rooms, and no painter may write over
`STAIRS`, a `DOOR`, a thorn vault's seal, or the player's start tile.

After painting, assert with the generator's own `allRoomsReachable(rooms, player.x, player.y)`.
If it fails, **revert the paint and generate the floor unpainted** rather than shipping a broken
level — a plain floor is a far better failure than an unwinnable one.

## Done when

- Forest and Lake floors have water; Forest has grass; Caves have rubble. Crypt and Town are
  untouched.
- Crossing water or rubble visibly costs more than open floor.
- A biome without a `terrain` block generates byte-identically to today.
- `editor.js` can edit the `terrain` block (rule 2).

## Verify

```sh
node tests/smoke.js
```
The smoke test already proves the stairs are reachable on every floor across 25 depths — with
terrain painted, that assertion is now doing the real work of this packet. **Raise its iteration
count for this run** (`node tests/smoke.js --iterations 20`) so rare paints get exercised, and
say in the commit what count you ran.

Then look at it:
```js
cantori.regenerate(); cantori.rooms()
```
on a Forest floor, and walk into water to feel the cost.
