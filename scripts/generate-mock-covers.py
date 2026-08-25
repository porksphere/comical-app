"""Generate the mock catalog's cover art.

The mock catalog used to point every cover at picsum.photos, which meant two things: the "comics"
were stock photographs of skyscrapers and laptops, and mock mode — including the e2e suite and the
GitHub Pages demo — needed a third-party service to be up before it could render a grid.

These are drawn instead: flat two- or three-tone fields with one rounded motif, everything derived
from the series seed so a given series always gets the same cover. Two thirds are monochrome. That
is deliberately more than half, because an even split does not READ as even — a saturated card
pulls far more attention than a neutral one, so a true coin flip looks like a colour grid with a
few greys in it.

Run:  python3 scripts/generate-mock-covers.py
Writes apps/mobile/assets/mock/covers/NN.png. Committed output; rerun only to change the design.
"""
from PIL import Image, ImageDraw
import colorsys, math

def fnv(s):
    x=2166136261
    for c in s: x=((x^ord(c))*16777619)&0xFFFFFFFF
    return x
def rgb(h,s,v): return tuple(int(c*255) for c in colorsys.hsv_to_rgb(h%1.0,s,v))

def cover(seed, W=300, H=450, SS=2):
    """Text-free, all-curves. Rendered at SSx then downsampled so every edge is smooth."""
    n=fnv(seed)
    w,h=W*SS,H*SS
    hue=(((n>>9)*47)%360)/360.0
    dark=((n>>2)&1)==0
    # Half the shelf is monochrome, half is colour. Keeping chroma HIGH but pulling value down is
    # what separates "rich" from both of the failure modes: value 0.93 gave neon, and dropping
    # saturation to fix that just looked washed out. These are deep — jewel rather than fluorescent.
    # Weighted to two thirds, not half. An even split measures 50/50 but does not READ as it: a
    # saturated card pulls far more attention than a neutral one, so a true coin-flip looks like a
    # colour grid with a few greys in it. Over-weighting the neutrals is what makes it look even.
    # Xor-folded before the modulo, for the same reason the chapter numbers needed it: FNV's low
    # bits are weak, and `(n>>5) % 100` on sequential seeds clustered so hard that one shelf came
    # out 18/18 monochrome while the catalog overall sat at 56%.
    mono=((n^(n>>15))%100)<66
    g=lambda v: rgb(0,0,v)
    if mono:
        if dark: bg=g(0.13); ink=g(0.74); alt=g(0.40)
        else:    bg=g(0.90); ink=g(0.15); alt=g(0.52)
    elif dark:   bg=rgb(hue,0.68,0.26); ink=rgb(hue+0.07,0.72,0.70); alt=rgb(hue+0.48,0.52,0.52)
    else:        bg=rgb(hue,0.62,0.74); ink=rgb(hue+0.50,0.66,0.30); alt=rgb(hue+0.09,0.42,0.90)
    im=Image.new('RGB',(w,h),bg); d=ImageDraw.Draw(im,'RGBA')
    m=(n>>21)%6

    if m==0:                                             # big sun low on the field
        r=w*0.62; cy=h*0.66
        d.ellipse([w/2-r,cy-r,w/2+r,cy+r],fill=ink)
        d.ellipse([w/2-r*0.42,cy-r*0.42,w/2+r*0.42,cy+r*0.42],fill=alt)
    elif m==1:                                           # concentric rings
        for i in range(7):
            r=w*(0.70-i*0.088); cx,cy=w*0.5,h*0.46
            d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=ink if i%2==0 else bg)
        d.ellipse([w*0.42,h*0.38,w*0.58,h*0.54],fill=alt)
    elif m==2:                                           # wave bands, opaque
        # Opaque, not alpha-over-background: translucent bands blended with a saturated ground
        # into greys and olives that looked like a printing fault rather than a design.
        cols=[ink,alt,bg,ink]
        for b in range(4):
            base=h*0.22+b*h*0.19; amp=h*0.05; pts=[]
            for x in range(0,w+1,4):
                pts.append((x, base+math.sin(x/w*math.pi*2.2+b*1.3)*amp))
            pts += [(w,h),(0,h)]
            d.polygon(pts, fill=cols[b])
    elif m==3:                                           # halftone, non-merging
        rows,cols_n=11,8
        sx,sy=w*0.115,h*0.082
        for row in range(rows):
            for col in range(cols_n):
                # Cap the radius under half the spacing so the largest dots stay separate instead
                # of fusing into a solid block at the foot of the cover.
                r=min(1.5*SS+row*1.7*SS, min(sx,sy)*0.46)
                cx,cy=w*0.09+col*sx, h*0.08+row*sy
                d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=ink)
    elif m==4:                                           # overlapping discs, opaque
        for fx,fy,fr,c in [(0.32,0.34,0.31,ink),(0.68,0.42,0.31,alt),(0.50,0.68,0.29,ink)]:
            r=w*fr; cx,cy=w*fx,h*fy
            d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=c)
    else:                                                # nested arches
        for i in range(4):
            pad=w*0.11+i*w*0.095
            top=h*0.18+i*h*0.11
            # Run the bottom well past the canvas: rounding both ends left a keyhole-shaped gap
            # at the foot of the cover.
            d.rounded_rectangle([pad,top,w-pad,h*1.25],radius=(w-2*pad)/2,
                                fill=ink if i%2==0 else alt)
    return im.resize((W,H), Image.LANCZOS)

import os
ROOT = os.path.join(os.path.dirname(__file__), '..', 'apps', 'mobile', 'assets', 'mock')

def emit(subdir, specs):
    out = os.path.join(ROOT, subdir)
    os.makedirs(out, exist_ok=True)
    total = 0
    for i, (seed, w, h) in enumerate(specs):
        dst = os.path.join(out, f'{i:02d}.png')
        cover(seed, W=w, H=h).convert('P', palette=Image.ADAPTIVE, colors=32).save(dst, optimize=True)
        total += os.path.getsize(dst)
    print(f'  {subdir}/: {len(specs)} files, {total // 1024} KB')
    return total

# Seeded by index, not by series id: the app indexes into these fixed sets, so the art only has to
# be varied across a set rather than unique per series.
t = emit('covers', [(f'cover-{i}', 300, 450) for i in range(24)])

# One mock bridge reports covers that AREN'T a uniform 2:3, so `SeriesCard`'s aspect-ratio-lands
# shrink animation has something to fire on. These shapes mirror VARIED_COVER_SHAPES in mock.ts —
# keep the two lists in step.
t += emit('covers-varied', [(f'varied-{i}', w, h) for i, (w, h) in enumerate(
    [(300, 450), (300, 400), (300, 350), (300, 300), (300, 220)])])

# Bridge list icons, square and small.
t += emit('thumbs', [(f'thumb-{i}', 100, 100) for i in range(6)])
print(f'total {t // 1024} KB')
