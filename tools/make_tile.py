#!/usr/bin/env python3
"""Generate placeholder sprite tiles for data.js entries that have no art yet.

CLAUDE.md rule 3: every monster/boss key in data.js loads assets/tiles/<key>.png,
and a key with no file renders blank and 404s. Real art is CC0 Dungeon Crawl Stone
Soup tiles (see ART-CREDITS.md) — but while a new monster is being designed, this
gives it a readable stand-in tinted to its own `color` from data.js, so a content
packet is never blocked on sourcing art.

No third-party libraries — same hand-rolled PNG writer as tools/make_icons.py.

    python3 tools/make_tile.py --missing        # every key in data.js lacking a tile
    python3 tools/make_tile.py healing_node     # just this one
    python3 tools/make_tile.py newmob --force   # overwrite an existing tile
"""
import argparse
import json
import math
import os
import re
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
TILES = os.path.join(ROOT, "assets", "tiles")
DATA_JS = os.path.join(ROOT, "data.js")
SIZE = 32   # every existing tile is 32x32 RGBA


def load_data():
    """Read window.CANTORI_DATA out of data.js as JSON."""
    src = open(DATA_JS, encoding="utf-8").read()
    body = src[src.index("{"):src.rindex("}") + 1]
    body = re.sub(r",(\s*[}\]])", r"\1", body)   # tolerate trailing commas
    return json.loads(body)


def creature_keys(data):
    """Every key the game will try to load a tile for."""
    return list(data.get("monsters", {})) + list(data.get("bosses", {}))


def hex_rgb(s, fallback=(0xC9, 0xB4, 0x8F)):
    s = (s or "").lstrip("#")
    if len(s) != 6:
        return fallback
    try:
        return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return fallback


def shade(rgb, amount):
    return tuple(max(0, min(255, round(c * amount))) for c in rgb)


def pixel(nx, ny, base):
    """nx, ny in -1..1 (centre = 0). Returns (r, g, b, a).

    A faceted gem: a bright diamond core, a darker bevelled shoulder, and a soft
    halo — legible at 32px and obviously a placeholder rather than real art.
    """
    dia = abs(nx) + abs(ny)          # Manhattan -> diamond
    rad = math.hypot(nx, ny)

    if dia < 0.34:                                  # bright core, lit from upper-left
        lit = 1.15 - 0.45 * (nx * 0.5 + ny)
        return shade(base, max(0.35, min(1.4, lit))) + (255,)
    if dia < 0.62:                                  # bevelled shoulder
        return shade(base, 0.55) + (255,)
    if dia < 0.72:                                  # rim
        return shade(base, 0.9) + (255,)
    if rad < 0.95:                                  # halo, fading out
        a = int(90 * max(0.0, 1.0 - rad / 0.95) ** 1.5)
        return shade(base, 0.7) + (a,)
    return (0, 0, 0, 0)


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))


def png_bytes(w, h, raw_rgba):
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)   # 8-bit RGBA
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw_rgba, 9)) + chunk(b"IEND", b"")


def make(color):
    base = hex_rgb(color)
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)   # PNG filter type 0 per row
        for x in range(SIZE):
            nx = (x + 0.5) / SIZE * 2 - 1
            ny = (y + 0.5) / SIZE * 2 - 1
            raw += bytes(pixel(nx, ny, base))
    return png_bytes(SIZE, SIZE, bytes(raw))


def write_tile(key, color, force):
    path = os.path.join(TILES, key + ".png")
    if os.path.exists(path) and not force:
        print("skip (exists):", key)
        return False
    os.makedirs(TILES, exist_ok=True)
    with open(path, "wb") as f:
        f.write(make(color))
    print("wrote", os.path.relpath(path, ROOT), "(placeholder, tinted %s)" % (color or "default"))
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("keys", nargs="*", help="data.js monster/boss keys to generate")
    ap.add_argument("--missing", action="store_true", help="generate for every key with no tile")
    ap.add_argument("--force", action="store_true", help="overwrite existing tiles")
    args = ap.parse_args()

    data = load_data()
    entries = {}
    entries.update(data.get("monsters", {}))
    entries.update(data.get("bosses", {}))

    if args.missing:
        keys = [k for k in creature_keys(data)
                if not os.path.exists(os.path.join(TILES, k + ".png"))]
        if not keys:
            print("nothing missing — every data.js creature has a tile")
            return
    else:
        keys = args.keys
        if not keys:
            ap.error("give one or more keys, or --missing")

    for key in keys:
        if key not in entries:
            print("warning: '%s' is not a monster or boss in data.js" % key)
        write_tile(key, (entries.get(key) or {}).get("color"), args.force)


if __name__ == "__main__":
    main()
