# Art Credits

The pixel-art sprites in `assets/tiles/` are from **Dungeon Crawl Stone Soup**
(https://github.com/crawl/crawl), whose tiles and artwork are released under the
**CC0 1.0 (public domain)** license
(https://creativecommons.org/publicdomain/zero/1.0/).

CC0 places no restrictions on use, but we credit the DCSS artists here with
thanks. Sprites used: player, rat, bat, adder (snake), wolf spider, goblin,
deep elf archer, dagger, short sword, mace, leather armour, chain mail, crystal
plate, potion, scroll, stone stairs, pebble floor, brick wall.

Sprite *filenames* track Cantori's own monster keys, which do not always match the
name DCSS gave the artwork — our Keener and Ember Fiend are drawn with DCSS tiles
originally published under other names, and our Goblin Archer wears DCSS's deep
elf archer, picked because the bow in its hands is the thing a player needs to
read at 32 pixels. Renaming a file changes nothing about the art's origin, and
the credit above covers it either way.

## Original tiles (also public domain)

Five of the crypt's monsters have no counterpart in the DCSS tileset, so their
sprites were drawn for Cantori rather than borrowed:

- `red_slime.png`, `black_slime.png`, `hollow_acolyte.png`, `brute.png`,
  `hollow_bard.png`

They are original work and are released into the **public domain (CC0 1.0)**, on
the same terms as the DCSS art beside them, so nothing about the project's
licensing changes by mixing the two. They are composed from simple shapes at
32×32 and are deliberately plain: they exist so no data row renders as a bare
glyph, and any of them can be replaced with a better tile — DCSS or otherwise —
by dropping a new PNG over the same filename. Nothing in the code needs to know.
