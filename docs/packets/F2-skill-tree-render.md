# F2 — draw the skill tree as a graph

**Depends on:** F1 (nodes must have `id`, `x`, `y`, and id-based `req`).
**Touch only:** `game.js` (Character screen section), `styles.css`, `index.html`.
**Read:** the "Character screen" section (line range in `docs/MAP.md`) —
`renderChar` and `charSkillsHTML`, which you are replacing, the `#char` / `.char-card` / `.skillrow` rules in `styles.css` (grep them), and grep
`touchstart` in the Touch section for the existing pinch/drag handling.
**Do NOT read `game.js` in full.**

## Goal

Replace the flat list of `.skillrow` cards in the Character screen's Skills tab with an actual
tree: circular icon nodes, arrows drawn between a node and its prerequisites, and rank badges.

## The visual to match

There is no image in the repo — this is the description of the reference, follow it literally.

**Layout.** Nodes flow **top to bottom in columns**, one column per branch, laid out from each
node's `x` (column) and `y` (row). The reference shows two parallel columns four rows deep, with
generous space between nodes — roughly one node-diameter of vertical gap for the arrow, and a
similar horizontal gap between columns.

**Nodes.** Large **circles** with a thick ornate ring border — big touch targets, roughly 88–100px
across on a phone. The skill's icon sits centred inside. Three states:

| State | Ring | Contents |
|---|---|---|
| **Invested** (rank ≥ 1) | bright amber, thick, slight outer glow | icon at full brightness |
| **Available** (rank 0, prerequisites met, points to spend) | dim amber, thinner — clearly reachable but not yet taken | icon at ~70% |
| **Locked** (prerequisites unmet) | grey, desaturated | icon dimmed to ~35% |

The reference marks the **selected** node with a **square** bracket border drawn around the
circle, in the same bright amber. Keep that: it is how the player knows which node the detail
panel below is describing.

**Rank badge.** Directly *below* each node, a small dark rounded pill with light text reading
`1/5`, `0/5` — current rank over max. It overlaps the bottom of the circle slightly. This
replaces the "rank X/Y" text in the old cards.

**Connectors.** An **arrow** from each prerequisite to its dependent, pointing *down* at the
dependent node, with a visible arrowhead. Two states, and this is the detail that makes the tree
readable at a glance:

- **amber** when the source node is invested — the path is live
- **grey** when it is not

A node with two prerequisites gets two arrows converging on it.

**Palette.** Use the tokens already in `styles.css` — `--amber` (#f0a838) is exactly the gold in
the reference, `--line` and `--ink-dim` cover the greys, and the card already sits on the dark
ground. Do not introduce a new palette.

## Implementation notes

- **Icons stay glyphs.** Skill cells carry `icon` as a character (`➤`, `✦`). Render that inside
  the ring; do **not** block on sprite art. Read an optional `iconSprite` field if present and
  fall back to the glyph, so art can arrive later without another packet.
- **Connectors want SVG.** `charBody` is DOM built via `innerHTML`. Put one absolutely-positioned
  `<svg>` layer *behind* the nodes and draw the arrows as `<line>`/`<path>` with a `<marker>`
  arrowhead. Position nodes with CSS from `x`/`y` so the SVG and the DOM agree on coordinates —
  compute both from one layout function, don't duplicate the maths.
- **It is a portrait phone screen.** A tree wider or taller than `#charBody` needs pan, and
  probably pinch-zoom. **Reuse the gesture handling that already exists** for the free-look
  dungeon camera rather than writing new pinch code — grep the Touch section. If reuse turns out
  to be awkward, a simple scroll container is an acceptable fallback; say so in the commit.
- **Keep the detail panel.** Tapping a node selects it and shows the existing content — name,
  description, current/next rank text, the Requires line, and the upgrade button. Reuse
  `charSkillsHTML`'s existing markup for that panel; only the *tree* replaces the card list.
- **Keep the upgrade binding working.** `renderChar` currently wires `upg-${key}` buttons after
  setting `innerHTML`. Whatever you build must re-bind the same way after each re-render, or
  upgrading silently stops working.

## Done when

- The Skills tab shows nodes, arrows and rank badges matching the description above.
- All three node states and both arrow states are visibly distinct at a glance on a phone.
- Tapping a node selects it (square border) and shows its detail; upgrading still works and
  re-renders with the new rank.
- A tree taller than the panel can be reached — by pan or scroll.
- No mechanics changed: same prerequisites, same costs, same refusals.

## Verify

```sh
node tests/smoke.js
```
By hand at `http://localhost:8000`, phone-width in device emulation:
```js
cantori.pickClass('warrior'); cantori.grant(10); cantori.toggleChar(true);
```
Click through to the Skills tab and check: locked nodes read as locked; buying a prerequisite
turns its outgoing arrow amber and its dependent from locked to available; the badge counts up;
the selected node is unmistakable. Confirm it is usable one-thumb at 430px wide — that is the
real target, not a desktop window.
