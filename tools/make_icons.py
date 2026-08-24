#!/usr/bin/env python3
"""Generate Cantori's app icons with no third-party libraries.

A torch-lit motif: a dark stone tile with a glowing amber diamond core.
Recognisable at small sizes and on-brand. The polished icon is a Depth 5
task; this just keeps the home-screen icon from being blank.
"""
import os
import struct
import zlib
import math

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

BG = (0x14, 0x10, 0x0a)      # warm stone dark
AMBER = (0xf0, 0xa8, 0x38)   # torch amber


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def pixel(nx, ny):
    """nx, ny in -1..1 (centre = 0). Returns an (r,g,b) tuple."""
    # Manhattan distance -> diamond; Euclidean -> soft glow halo
    dia = abs(nx) + abs(ny)
    rad = math.hypot(nx, ny)

    col = BG
    # soft amber halo
    halo = max(0.0, 1.0 - rad / 0.95) ** 2
    col = lerp(col, AMBER, 0.22 * halo)

    # concentric diamond: bright core, gap, ring
    if dia < 0.12:
        col = AMBER
    elif dia < 0.20:
        col = lerp(BG, AMBER, 0.15 * halo)
    elif dia < 0.34:
        col = lerp(AMBER, BG, 0.15)
    return col


def make(size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # PNG filter type 0 for each row
        for x in range(size):
            nx = (x + 0.5) / size * 2 - 1
            ny = (y + 0.5) / size * 2 - 1
            r, g, b = pixel(nx, ny)
            raw += bytes((r, g, b, 255))
    return png_bytes(size, size, bytes(raw))


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))


def png_bytes(w, h, raw_rgba):
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(raw_rgba, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = {
        "icon-512.png": 512,
        "icon-192.png": 192,
        "apple-touch-icon.png": 180,
    }
    for name, size in targets.items():
        path = os.path.join(OUT, name)
        with open(path, "wb") as f:
            f.write(make(size))
        print("wrote", os.path.normpath(path), f"({size}x{size})")


if __name__ == "__main__":
    main()
