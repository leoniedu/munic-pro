#!/usr/bin/env python3
"""Render extension/icons/icon{16,48,128}.png from assets/icon.svg.

Deliberately dependency-free: the shape is three rounded bars on a rounded
tile, which is cheaper to rasterise directly than to add a build step or an
SVG library to a project that otherwise has neither. If the artwork ever
gains curves this cannot express, replace this with a real rasteriser
rather than growing it.

Run from the repo root:  python3 scripts/gen-icons.py
"""
import struct
import zlib

BLUE = (0x00, 0x5A, 0x9C)
WHITE = (0xFF, 0xFF, 0xFF)
TILE_RADIUS = 24
BARS = [(28, 76, 18, 26, 3), (55, 58, 18, 44, 3), (82, 34, 18, 68, 3)]
SUPERSAMPLE = 4


def inside_rounded(x, y, w, h, r, px, py):
    if not (x <= px < x + w and y <= py < y + h):
        return False
    for cx, cy, tx, ty in (
        (x + r, y + r, px < x + r, py < y + r),
        (x + w - r, y + r, px > x + w - r, py < y + r),
        (x + r, y + h - r, px < x + r, py > y + h - r),
        (x + w - r, y + h - r, px > x + w - r, py > y + h - r),
    ):
        if tx and ty and (px - cx) ** 2 + (py - cy) ** 2 > r * r:
            return False
    return True


def render(size, ss=SUPERSAMPLE):
    scale = size * ss / 128.0
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            rs = gs = bs = cov = 0
            for sy in range(ss):
                for sx in range(ss):
                    px = (x * ss + sx + 0.5) / scale
                    py = (y * ss + sy + 0.5) / scale
                    if not inside_rounded(0, 0, 128, 128, TILE_RADIUS, px, py):
                        continue
                    colour = BLUE
                    for bx, by, bw, bh, br in BARS:
                        if inside_rounded(bx, by, bw, bh, br, px, py):
                            colour = WHITE
                            break
                    rs += colour[0]
                    gs += colour[1]
                    bs += colour[2]
                    cov += 1
            if cov:
                alpha = int(255 * cov / (ss * ss))
                row += bytes((rs // cov, gs // cov, bs // cov, alpha))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))

    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


if __name__ == "__main__":
    for s in (16, 48, 128):
        path = f"extension/icons/icon{s}.png"
        with open(path, "wb") as fh:
            fh.write(render(s))
        print(f"wrote {path}")
