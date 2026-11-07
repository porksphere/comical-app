"""Generate the soft shadow drawn under a book cover, and its dark-mode glow (Settings -> General ->
Book covers).

A soft shadow is most of what makes Apple Books' covers read as objects, and a live one is what a
scrolling grid can't afford: a boxShadow is a masked shadow layer per card on iOS and a BlurMaskFilter
paint on Android, rebuilt whenever a recycled card changes size. So the blur happens once, here, and
every card stretches the same pictures under itself.

Measured off Apple Books on an iPhone, in units of the cover's width:
  light: a neutral shadow, about 0.22 at the foot, half that a tenth of the way down and gone by
         about 0.2; about 0.08 at the sides, gone within about 0.07.
  dark:  the same shape as a glow in the COVER'S OWN COLOURS — the foot about a quarter of the
         cover's bottom colour, the rim about a tenth of a paler top colour.
So light mode gets one black picture, and dark mode two white ones, a rim and a foot, which the app
tints with each cover's top and bottom tones (lib/cover-tones).

Each picture is laid out for a 2:3 cover with SIDE/TOP/FOOT of margin around it, which must match
SHADOW_BOX in apps/mobile/src/lib/book-cover.ts.

Run:  python3 scripts/generate-book-shadow.py
Writes apps/mobile/assets/images/book-shadow-light.png and book-glow-{rim,foot}.png. Committed output;
rerun only to change the design.
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter

PX = 100                          # pixels per cover width; the pictures are all blur, so they upscale cleanly
SIDE, TOP, FOOT = 0.15, 0.12, 0.32
COVER_H = 1.5                     # a 2:3 cover

# Two layers: a tight one all round (the rim), and a softer one lower down that makes the foot. The
# foot is inset at the sides so the sides keep the rim's weight.
RIM = dict(rect=(0, 0.04, 1, COVER_H), sigma=0.048)
FOOT_LAYER = dict(rect=(0.12, 0.08, 0.88, COVER_H + 0.08), sigma=0.08)

W_PX = round((1 + 2 * SIDE) * PX)
H_PX = round((COVER_H + TOP + FOOT) * PX)
OUT = 'apps/mobile/assets/images'


def layer(rect, sigma, alpha):
    im = Image.new('L', (W_PX, H_PX), 0)
    x0, y0, x1, y1 = rect
    box = [(x0 + SIDE) * PX, (y0 + TOP) * PX, (x1 + SIDE) * PX, (y1 + TOP) * PX]
    ImageDraw.Draw(im).rectangle(box, fill=round(255 * alpha))
    return im.filter(ImageFilter.GaussianBlur(sigma * PX))


def over(a, b):
    """1 - (1 - a)(1 - b): two layers laid over each other."""
    return ImageChops.invert(ImageChops.multiply(ImageChops.invert(a), ImageChops.invert(b)))


def save(alpha, rgb, name):
    # The cover hides what is under it; clear it anyway, so a CG set's offset sheets show page through
    # their gap rather than a patch of shadow.
    ImageDraw.Draw(alpha).rectangle([SIDE * PX, TOP * PX, (1 + SIDE) * PX - 1, (COVER_H + TOP) * PX - 1], fill=0)
    out = Image.new('RGBA', (W_PX, H_PX), rgb + (0,))
    out.putalpha(alpha)
    out.save(f'{OUT}/{name}.png', optimize=True)


save(over(layer(**RIM, alpha=0.16), layer(**FOOT_LAYER, alpha=0.22)), (0, 0, 0), 'book-shadow-light')
save(layer(**RIM, alpha=0.30), (255, 255, 255), 'book-glow-rim')
save(layer(**FOOT_LAYER, alpha=0.30), (255, 255, 255), 'book-glow-foot')
