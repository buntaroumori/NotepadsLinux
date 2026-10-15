#!/usr/bin/env python3
"""
scripts/make-icons.py — generates every icon the Tauri bundler asks for.

The artwork is original to this project (see NOTICE): a Fluent-style rounded tile
with a diagonal accent gradient and a stylised page with a folded corner, in the
same visual family as the original Windows app's icon.

    python3 scripts/make-icons.py             # writes src-tauri/icons/
    python3 scripts/make-icons.py --preview    # also writes docs/screenshots/icon-512.png

Requires Pillow (pip install pillow).

Implementation note: the gradient is built tiny and scaled up with BICUBIC, and
the vector-ish artwork is drawn once on a 1024px master. Anything heavier (per
pixel Python loops on multi-megapixel canvases) is a memory / time trap on small
machines, which is exactly what an earlier revision of this script ran into.
"""

from __future__ import annotations

import argparse
import os
import struct
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required:  pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "src-tauri", "icons")
PACKAGING_DIR = os.path.join(ROOT, "packaging")
DOCS_DIR = os.path.join(ROOT, "docs", "screenshots")

MASTER = 1024
TOP = (0x4C, 0xA8, 0xF0)  # Fluent blue, light end
BOTTOM = (0x00, 0x4E, 0x92)  # dark end
SHEET = (0xFF, 0xFF, 0xFF)
SHEET_SHADE = (0xDD, 0xE9, 0xF5)
RULE_STRONG = (0x10, 0x6E, 0xBE)
RULE_SOFT = (0x93, 0xBB, 0xDB)


def gradient_tile(size: int) -> Image.Image:
    """Rounded square tile with a smooth diagonal gradient."""
    # 1. tiny diagonal gradient, then scale up: no per-pixel loop on the big image
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = (
                round(TOP[0] + (BOTTOM[0] - TOP[0]) * t),
                round(TOP[1] + (BOTTOM[1] - TOP[1]) * t),
                round(TOP[2] + (BOTTOM[2] - TOP[2]) * t),
            )
    grad = small.resize((size, size), Image.BICUBIC)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * 0.225), fill=255
    )
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile.paste(grad, (0, 0), mask)
    return tile


def draw_page(canvas: Image.Image) -> None:
    size = MASTER
    d = ImageDraw.Draw(canvas, "RGBA")

    left = int(0.272 * size)
    top = int(0.180 * size)
    right = int(0.748 * size)
    bottom = int(0.826 * size)
    fold = int(0.150 * size)
    radius = int(0.050 * size)

    # drop shadow (offset, no blur: cheap and still reads as depth at icon sizes)
    d.rounded_rectangle(
        [left, top + int(0.020 * size), right, bottom + int(0.020 * size)],
        radius=radius,
        fill=(0, 0, 0, 60),
    )

    # sheet, top-right corner cut off for the fold
    d.polygon(
        [
            (left, top + radius),
            (left + radius, top),
            (right - fold, top),
            (right, top + fold),
            (right, bottom - radius),
            (right - radius, bottom),
            (left + radius, bottom),
            (left, bottom - radius),
        ],
        fill=SHEET,
    )

    # folded corner
    d.polygon(
        [(right - fold, top + 1), (right - fold, top + fold), (right, top + fold)],
        fill=SHEET_SHADE,
    )

    # text rules
    x0 = left + int(0.085 * size)
    x1 = right - int(0.095 * size)
    rule_h = int(0.048 * size)
    step = int(0.112 * size)
    y = top + int(0.285 * size)
    for i, w in enumerate((1.0, 0.84, 0.92, 0.52)):
        d.rounded_rectangle(
            [x0, y + i * step, x0 + int((x1 - x0) * w), y + i * step + rule_h],
            radius=rule_h // 2,
            fill=RULE_STRONG if i == 0 else RULE_SOFT,
        )


def build_master() -> Image.Image:
    canvas = gradient_tile(MASTER)
    draw_page(canvas)
    return canvas


def write_icns(path: str, png_bytes: bytes) -> None:
    """Minimal ICNS container with a single 512x512 PNG payload ('ic09')."""
    payload = b"ic09" + struct.pack(">I", len(png_bytes) + 8) + png_bytes
    with open(path, "wb") as fh:
        fh.write(b"icns" + struct.pack(">I", len(payload) + 8) + payload)


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate the application icons.")
    ap.add_argument("--preview", action="store_true", help="also write docs/screenshots/icon-512.png")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    master = build_master()

    targets = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in targets.items():
        master.resize((size, size), Image.LANCZOS).save(os.path.join(OUT_DIR, name))
    print(f"  wrote {len(targets)} PNG sizes into src-tauri/icons/")

    master.save(
        os.path.join(OUT_DIR, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("  wrote src-tauri/icons/icon.ico")

    tmp = os.path.join(OUT_DIR, "_icns_payload.png")
    master.resize((512, 512), Image.LANCZOS).save(tmp, format="PNG")
    with open(tmp, "rb") as fh:
        write_icns(os.path.join(OUT_DIR, "icon.icns"), fh.read())
    os.remove(tmp)
    print("  wrote src-tauri/icons/icon.icns")

    os.makedirs(PACKAGING_DIR, exist_ok=True)
    master.resize((256, 256), Image.LANCZOS).save(
        os.path.join(PACKAGING_DIR, "notepads-for-linux.png")
    )
    print("  wrote packaging/notepads-for-linux.png")

    if args.preview:
        os.makedirs(DOCS_DIR, exist_ok=True)
        master.resize((512, 512), Image.LANCZOS).save(os.path.join(DOCS_DIR, "icon-512.png"))
        print("  wrote docs/screenshots/icon-512.png")

    print("icons done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
