# Cantori — working rules

A permadeath roguelike that runs as a static site (no build step, no dependencies) and is served by
GitHub Pages from `main`. Read `DESIGN.md` for where the game is headed and `README.md` for what it
does today.

## Layout

```
index.html          the page — also carries the ?v= cache-buster
data.js             ALL editable content: monsters, gear, consumables, biomes, bosses,
                    boons, loot config, classes + skill trees, stats, gods
loot.js             loot roll engine (rarity / tier / affix / identify)
game.js             the engine — map, FOV, combat, AI, bosses, render, UI
editor.html/.js     no-backend content editor that reads and writes data.js
assets/tiles/       sprites (CC0 Dungeon Crawl Stone Soup — see ART-CREDITS.md)
tests/              headless smoke test (see below)
```

`game.js` is large and organised by `// ---- Section ----` banners. Find your way around with those
rather than by line number — line numbers move.

## Before you start

**Never read `game.js` whole.** It is ~78k tokens and growing; reading it costs real money on every task and
buries the code you need in code you don't. `docs/MAP.md` lists every section with its line range
and token cost — read your section with `Read(game.js, offset=…, limit=…)`, or Grep for a symbol.
Regenerate the map with `python3 tools/make_map.py` after moving code between sections.

Line numbers drift with every merge, so **`docs/MAP.md` is the only file that should carry
them** — briefs name sections and symbols instead. Regenerate the map before you start reading.

`docs/PACKETS.md` is the work queue: numbered, self-contained briefs in `docs/packets/`, each
naming the files it may touch and how to verify it. If you were pointed at a packet, that brief
overrides your instincts about scope.

## Rules

**1. Content is data; behaviour is code.**
Adding a monster, weapon, consumable, boon, biome or class is a `data.js` edit. Only a genuinely new
*behaviour* (a summoner, a new skill `kind`, a boss playbook) touches `game.js`. If you find yourself
writing code to add a normal monster, the framework is being used wrong.

**2. Teach `editor.js` any new `data.js` field, in the same commit.**
The editor rewrites `data.js` wholesale when the user hits "Commit data.js". A field it doesn't know
about can be silently dropped the next time content is edited in the browser. Table editors preserve
unknown scalar fields, but anything structured (a new per-biome table, a new skill-tree cell shape)
needs editor support or it will be lost.

**3. A monster's sprite ships with its data row.**
`SPRITE_NAMES` is derived from `Object.keys(DATA.monsters)` and `DATA.bosses`, and loads
`assets/tiles/<key>.png`. A data row without a matching PNG renders blank. Sprites must be CC0 or
public domain, and credited in `ART-CREDITS.md`.

**4. Bump the `?v=` cache-buster in `index.html`** whenever `game.js`, `data.js`, `loot.js` or
`styles.css` changes. All four query strings move together. Phones aggressively cache; skipping this
means the user tests stale code and reports phantom bugs.

**5. New terrain must be added to every map predicate.**
Tiles today are `WALL / FLOOR / STAIRS / DOOR / THORN`. Note `passable()` is written as
"anything that isn't `WALL`", so a new tile is walkable by default. Any new tile must be considered in:

- `passable()` and `isWall()` — movement
- `blocksSight()` — FOV
- `floodReach()` and `allRoomsReachable()` — the generator's connectivity guarantee
- `fixOpenCorners()` — no diagonal-only wall/floor touches
- auto-travel pathing, and the renderer

Miss one and levels become unwinnable in ways that only surface on rare seeds. This is the single
most common way to break the game.

**6. Run the smoke test before committing:** `node tests/smoke.js`.

**7. Keep the run deterministic-ish and permadeath real.** Death clears progress. Don't add anything
that silently rescues the player.

## Testing

`node tests/smoke.js` boots the real page in headless Chromium and drives it through
`window.cantori`, asserting no console errors and that every floor is completable. Run it after any
change to `game.js`, `data.js` or `loot.js`.

Play it by hand with `python3 -m http.server 8000`, then open `http://localhost:8000`.

`window.cantori` (browser console) exposes a large dev surface — among the most useful:

| Call | Does |
|---|---|
| `descend()` | go down one floor |
| `regenerate()` | rebuild the current floor |
| `restart()` / `beginNewRun()` | new run |
| `place(x, y)` | teleport the player |
| `peek()` | full player/run state dump |
| `setClass(k)` / `pickClass(k)` | switch class |
| `give(k)` / `giveGear(k, o)` | spawn items |
| `grant(n)` / `learn(k)` / `doSkill(k)` | skill points and skills |
| `giveBoon(k)` | grant a boon |
| `hurt(n)` / `setGold(n)` / `setStat(k, v)` | poke the player |
| `rooms()` / `attachInfo()` | last level's room layout |

Content changes can also be tested without touching code: open `editor.html` and hit **Playtest**,
which stores a draft in `localStorage` and shows a green ⚙ DRAFT badge in the game.

## Style

Match the surrounding code: plain ES5-ish browser JavaScript in one IIFE, no modules or build tooling,
two-space indent, and comments that explain *why* a rule exists (the existing comments are unusually
good — keep that bar). No new dependencies.
