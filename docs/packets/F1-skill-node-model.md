# F1 — skill trees as a node graph (data model)

**Depends on:** nothing.
**Touch only:** `game.js` (Skills section), `data.js`, `editor.js`, `index.html`.
**Read:** the "Skills" section (line range in `docs/MAP.md`) — `treeSkills`,
`prereqsMet`, `learnSkill`, and grep `skillTree` in `editor.js` for the 5×5 form.
**Do NOT read `game.js` in full.**

## Goal

Skills are authored today as a fixed **5×5 grid** — `skillTree[tier][slot]` — and prerequisites
address cells by grid coordinate: `req: [[tier, slot], …]`, `reqAny: [[tier, slot, minRank], …]`,
resolved through `skillAtPos(t, s)`.

The grid is the only thing stopping trees from being real trees: you cannot have a node with two
parents from different rows, a long chain, a diamond, or two branches of different depths.

This packet moves to **a flat list of nodes with explicit ids and positions**. It ships **no
visual change** — F2 draws the graph, F3 rebuilds the editor. Doing the data move on its own
keeps the risky part isolated and reviewable.

## New shape

```json
"skillTree": [
  { "id": "rush", "x": 0, "y": 0, "name": "Rush", "icon": "➤", "kind": "rush",
    "desc": "…", "levels": ["…"], "ranks": [ … ], "req": [], "reqAny": [] },
  { "id": "smite", "x": 0, "y": 1, "req": ["rush"], … },
  { "id": "cleave", "x": 1, "y": 2, "reqAny": [["smite", 2], ["spin", 1]], … }
]
```

- `id` — stable string, unique per class. This is what `req` points at now.
- `x`, `y` — grid-ish layout coordinates, small integers (column, row). Not pixels: F2 decides
  spacing. Keeping them integers means the editor can snap and trees stay tidy.
- `req: ["id", …]` — every one needed at rank ≥ 1.
- `reqAny: [["id", minRank], …]` — any one satisfies. Keep the existing bare-string form working
  too (`["id"]` meaning minRank 1).

`key` stays supported as an alias for `id` — existing cells already carry `key`, and the skill
key is what `player.skills`, the hotbar and the dev hooks are keyed by. **Do not rename the
runtime skill keys**; only the addressing of prerequisites changes.

## Migration — the part that can lose data

`editor.html` writes `data.js` wholesale. If the editor and the game disagree about the shape
even briefly, a content save silently destroys the authored trees. So:

1. Write `normalizeTree(raw)` in `game.js`, used by `treeSkills`. It accepts **either** shape:
   - old: array of 5 rows × 5 cells, `req` entries that are `[t, s]` pairs → derive
     `id` from the existing `key`/slug, set `x = slot`, `y = tier`, and rewrite coordinate
     prerequisites into id prerequisites.
   - new: flat array of nodes → use as-is.
2. Convert the authored warrior and monk trees in `data.js` to the new shape in this same commit.
3. Teach `editor.js` to read and write the new shape, and to run the same normalization on load
   so an older draft in `localStorage` still opens. **This is not optional** and not a follow-up —
   rule 2 in `CLAUDE.md` exists for exactly this failure.

`normalizeTree` stays in the codebase permanently. It is cheap, and it means a stale draft or an
old `data.js` from git history never bricks the Skills tab.

## Code that changes

- `treeSkills()` — build `skills` keyed by id, and replace `byPos` with `byId`. It currently
  caches per class; keep that.
- `skillAtPos(t, s)` — delete, or keep as a thin shim used only by `normalizeTree`.
- `prereqsMet(d)` — resolve `req`/`reqAny` through ids instead of positions. The *logic* (all vs
  any, `minRank`) is already right; only the lookup changes.
- `prereqNames(d)` — same.
- `pos` on a skill def becomes `{ x, y }`; F2 will use it.

Nothing else should need touching. `learnSkill`, the hotbar, `useSkill`, and the dev hooks all
work on skill keys and are unaffected — verify that claim by grepping `byPos` and `skillAtPos`
and confirming you have found every caller.

## Done when

- Both authored trees are in the new shape and behave **identically** in game: same skills, same
  prerequisites, same "Requires: X" messages, same upgrade behaviour.
- A tree can express a node with two parents and branches of unequal depth — demonstrate with a
  scratch node in a Playtest draft, then remove it.
- Loading an *old-shape* `data.js` still works via `normalizeTree`.
- The editor round-trips: open `editor.html`, change something unrelated, Commit `data.js`, and
  confirm the trees survive intact. **Test this explicitly — it is the failure mode.**

## Verify

```sh
node tests/smoke.js
```
```js
cantori.pickClass('warrior'); cantori.grant(10);
cantori.skills()                        // every skill present, rank 0
cantori.learn('smite')                  // refused — prerequisite not met
cantori.learn('rush'); cantori.learn('smite')   // now allowed
```
Then the editor round-trip above, which the smoke test cannot cover.
