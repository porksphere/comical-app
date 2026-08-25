#!/usr/bin/env python3
"""Turn raw simulator captures into the README's screenshots: crop the status bar, round the
corners, downscale. Rewrites each file in place.

Used by `.github/workflows/capture-demo.yml` over the PNGs `e2e/demo/screens.yaml` shoots.

The corners are baked into the pixels because there is nowhere else to put them. GitHub strips
`style` from README HTML — its sanitiser allows only src/longdesc/loading/alt on `img` — so the
alternative to baking is a square screenshot, not a stylesheet.
"""
import sys

from PIL import Image, ImageDraw

# Fraction of the capture's HEIGHT taken off the top, not a pixel count: the simulator is whichever
# iPhone the runtime offers, so the raw height changes when that does. 5.5% clears the status bar on
# a modern iPhone with room to spare and stops short of the app's first row. The clock, wifi and
# battery say nothing about the app and date the screenshot.
CROP_TOP = 0.055

# Corner radius as a fraction of WIDTH, for the same reason. The device's own radius is about 15% of
# its width (62pt on the iPhone 16 Pro's 402pt), and that is deliberately NOT what this is: the top
# edge here is a crop line rather than a device edge, so matching the hardware would round a corner
# that is not a corner and dwarf the header behind it. 7% reads as a screen at the size the README
# shows these.
RADIUS = 0.07


def shape(path: str, width: int) -> None:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    im = im.crop((0, round(h * CROP_TOP), w, h))
    w, h = im.size

    # Mask at the CAPTURE's resolution and downscale afterwards. `rounded_rectangle` draws a hard
    # edge, and the ~3x reduction below is what averages it into a smooth one — masking after the
    # resize would leave the curve visibly stepped.
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=round(w * RADIUS), fill=255)
    im.putalpha(mask)

    im = im.resize((width, round(h * width / w)), Image.LANCZOS)
    im.save(path, "PNG", optimize=True)


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 2:
        sys.exit("usage: shape-screenshots.py <width> <png>...")
    width = int(args[0])
    for path in args[1:]:
        shape(path, width)
        print(f"  shaped {path}")


if __name__ == "__main__":
    main()
