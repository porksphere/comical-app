#!/usr/bin/env python3
"""Turn raw simulator captures into the README's screenshots: round the corners and downscale.
Rewrites each file in place.

Used by `.github/workflows/capture-demo.yml` over the PNGs `e2e/demo/screens.yaml` shoots.

THE CORNERS ARE SYNTHESISED, not the device's own. The simulator does have a real screen mask, and
`xcrun simctl io <udid> screenshot --mask=alpha` bakes it in exactly — but Maestro takes these
screenshots from inside the flow, and it doesn't expose that flag. Getting the true mask would mean
splitting the flow into one file per shot so the workflow could call simctl between them, at ~90s of
Maestro driver startup each. A rounded rectangle at the device's own ratio is worth more than that.

They have to be baked into the pixels either way: GitHub strips `style` from README HTML — its
sanitiser allows only src/longdesc/loading/alt on `img` — so the alternative is a square screenshot,
not a stylesheet.
"""
import sys

from PIL import Image, ImageDraw

# Corner radius as a fraction of WIDTH rather than a pixel count: the workflow shoots on whichever
# iPhone the installed runtime offers, so the raw size changes when that does. 15.4% is the iPhone
# 16 Pro's own ratio (62pt over 402pt), and modern iPhones sit close enough to it (~14–15.5%) that
# the fraction survives a device change better than a fixed radius would.
#
# The status bar is deliberately still in frame. It was cropped off once, back when these were meant
# to read as bare app screens; keeping it makes the top edge a real device edge, which is what makes
# a device-accurate radius correct here rather than a corner invented on a crop line. The workflow
# pins it to 9:41 with fixed battery and signal, so re-shoots stay identical.
RADIUS = 0.154


def shape(path: str, width: int) -> None:
    im = Image.open(path).convert("RGB")
    w, h = im.size

    # Mask at the CAPTURE's resolution and downscale afterwards. `rounded_rectangle` draws a hard
    # edge, and the ~3x reduction below is what averages it into a smooth one — masking after the
    # resize would leave the curve visibly stepped.
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=round(w * RADIUS), fill=255)
    im.putalpha(mask)

    im.resize((width, round(h * width / w)), Image.LANCZOS).save(path, "PNG", optimize=True)


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
