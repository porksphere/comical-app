"""Generate the soft shadow drawn under a book cover (Settings -> General -> Book covers).

A soft shadow is most of what makes Apple Books' covers read as objects, and a live one is what a
scrolling grid can't afford: a boxShadow is a masked shadow layer per card on iOS and a BlurMaskFilter
paint on Android, rebuilt whenever a recycled card changes size. So the blur happens once, here, and
every card stretches the same picture under itself.

The falloff is measured off Apple Books on an iPhone, in units of the cover's width: about 0.22 at the
foot, half that a tenth of the way down and gone by about 0.2; about 0.08 at the sides, gone within
about 0.07. Apple's dark mode draws the same shape as a glow, so one alpha map serves both themes:
black for light, white for dark.

The picture is laid out for a 2:3 cover with SIDE/TOP/FOOT of margin around it, which must match
SHADOW_BOX in apps/mobile/src/lib/book-cover.ts.

Run:  python3 scripts/generate-book-shadow.py
Writes apps/mobile/assets/images/book-shadow-{light,dark}.png. Committed output; rerun only to
change the design.
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter

PX = 100                          # pixels per cover width; the picture is all blur, so it upscales cleanly
SIDE, TOP, FOOT = 0.15, 0.12, 0.32
COVER_H = 1.5                     # a 2:3 cover

# Two shadows over each other: a tight one all round, and a softer one lower down that makes the foot.
# The second is inset at the sides so the sides keep the first one's weight.
AMBIENT = dict(rect=(0, 0.04, 1, COVER_H), sigma=0.048, alpha=0.16)
KEY = dict(rect=(0.12, 0.08, 0.88, COVER_H + 0.08), sigma=0.08, alpha=0.22)

W_PX = round((1 + 2 * SIDE) * PX)
H_PX = round((COVER_H + TOP + FOOT) * PX)


def layer(rect, sigma, alpha):
    im = Image.new('L', (W_PX, H_PX), 0)
    x0, y0, x1, y1 = rect
    box = [(x0 + SIDE) * PX, (y0 + TOP) * PX, (x1 + SIDE) * PX, (y1 + TOP) * PX]
    ImageDraw.Draw(im).rectangle(box, fill=round(255 * alpha))
    return im.filter(ImageFilter.GaussianBlur(sigma * PX))


# 1 - (1 - a)(1 - k): the two laid over each other.
inverse = ImageChops.multiply(ImageChops.invert(layer(**AMBIENT)), ImageChops.invert(layer(**KEY)))
alpha = ImageChops.invert(inverse)
# The cover hides what is under it; clear it anyway, so a CG set's offset sheets show page through
# their gap rather than a patch of shadow.
ImageDraw.Draw(alpha).rectangle([SIDE * PX, TOP * PX, (1 + SIDE) * PX - 1, (COVER_H + TOP) * PX - 1], fill=0)

for name, rgb in (('light', (0, 0, 0)), ('dark', (255, 255, 255))):
    out = Image.new('RGBA', (W_PX, H_PX), rgb + (0,))
    out.putalpha(alpha)
    out.save(f'apps/mobile/assets/images/book-shadow-{name}.png', optimize=True)
