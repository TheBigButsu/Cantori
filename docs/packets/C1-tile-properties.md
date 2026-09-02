# C1 — a tile property table

**Depends on:** nothing.
**Touch only:** `game.js`, `index.html`, `tests/smoke.js`.
**Read:** the "Map model" section (line range in `docs/MAP.md`), then
`grep -n 'THORN\|isThorn' game.js` — that list *is* the specification for this packet.
**Do NOT read `game.js` in full.**

## Goal

Adding a terrain tile today means finding every place that tests for one. `THORN` has **28
touchpoints**: movement, sight, connectivity, monster avoidance, auto-travel, the renderer, the
floor map, examine text, charge, knockback, item placement, the dev hooks. Five new tiles done
that way is ~140 scattered edits and a near-certain violation of `CLAUDE.md` rule 5 — a tile
missed in one predicate makes rare seeds unwinnable.

So this packet adds **no new behaviour at all**. It replaces the scattered constant comparisons
with one property table, then declares the new tiles as data. **Nothing places them yet** — C2
and C3 do that. The whole value here is that afterwards a tile is a table row instead of a
28-site scavenger hunt.

## The table

Next to the tile constants in the Map model section:

```js
// What a tile IS, rather than which constant it equals. Every predicate below reads
// this table, so a new tile is a row here plus a draw case — not a hunt through the file.
const TILE = {
  [WALL]:   { solid: true, opaque: true },
  [FLOOR]:  {},
  [STAIRS]: {},
  [DOOR]:   {},                                    // sight handled by doorOpen()
  [THORN]:  { hurts: [5, 10], shun: true, noTravel: true },
  [WATER]:  { costMult: 2, blocksConnect: false },
  [CHASM]:  { falls: true, shun: true, noTravel: true, blocksConnect: true },
  [RUBBLE]: { costMult: 2 },
  [GRASS]:  { conceals: true },
};
const tileProp = (x, y, k) => { const t = inBounds(x, y) && map[y][x]; const p = TILE[t]; return p ? p[k] : undefined; };
```

| Property | Means |
|---|---|
| `solid` | blocks movement — `passable()` is exactly `!solid` |
| `opaque` | blocks line of sight |
| `hurts: [lo, hi]` | damages anything that steps through |
| `shun` | monsters refuse to enter (what `isThorn` guards today) |
| `noTravel` | auto-travel never routes through it; the player must step in deliberately |
| `blocksConnect` | counts as blocked when proving the level is completable |
| `costMult` | movement costs this much more |
| `falls` | stepping in drops you a floor |
| `conceals` | hides what stands in it |

`costMult`, `falls` and `conceals` are **declared but not implemented** here — C2/C3 use them.
Declaring them now keeps the vocabulary in one place; a property nothing reads yet is harmless.

## Convert the predicates

Work the grep list. Each becomes a property query:

- `passable(x, y)` → `inBounds(x, y) && !tileProp(x, y, "solid")`. **This is the important one.**
  It reads "anything that isn't `WALL`" today, so every tile you add is walkable by default —
  which is how a chasm silently becomes a floor.
- `blocksSight` → `opaque`, keeping the existing closed-door clause exactly as it is.
- `floodReach`'s `blocked` → `solid || blocksConnect || (blockThorns && hurts)`. A chasm must
  count as blocked: falling through it is not a route to the stairs.
- `isThorn(...)` at the ~14 monster-AI and pathing sites → a `shuns(x, y)` helper reading `shun`.
  **Keep `isThorn` itself** — the torch/burn interaction and the examine text are thorn-specific
  and should stay that way.
- Auto-travel (`walkTo`) → `noTravel`, replacing the "never auto-walk through thorns" check.
- `canStep`'s diagonal-squeeze test → `solid || shun`, so the same rule covers new hazards.

Anything genuinely specific to brambles — burning them, the vault sealing, `countThorns` — stays
as it is. Do not generalise those.

## The renderer

Give each new tile a draw case beside `drawThorn` in the dungeon view, **and** a colour in the
floor-map view (grep `mctx.fillStyle`). Placeholder colours are fine: water blue, chasm near
black, rubble grey, grass green. Nothing places them yet, so nothing will render — but a tile
without a draw case is an invisible hole waiting for C2.

Add examine text for each, next to the thorn line.

## Done when

- `TILE` exists, and every predicate above reads it rather than comparing constants.
- **Behaviour is provably identical.** Nothing places the new tiles, so the smoke test must pass
  unchanged — that is the whole acceptance test.
- Add one assertion to `tests/smoke.js`: every tile constant has a `TILE` row, so a future tile
  cannot be added without declaring what it is. Expose whatever small hook that needs.

## Verify

```sh
node tests/smoke.js
```
Then confirm the conversion didn't quietly change thorns, since they exercise most of the
properties:
```js
cantori.regenerate(); cantori.peek().thorns        // still placed, still counted
// walk into one: still costs 5-10 HP, still refuses to auto-travel through,
// monsters still won't follow you in, a torch still burns it away
```
