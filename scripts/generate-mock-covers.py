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
    # Avalanche. Raw FNV-1a correlates badly across seeds this similar ('cover-0'..'cover-23'):
    # bit 21 came out constant, so `(n>>21)%6` could only ever return 1, 3 or 5 and half the
    # motifs below were unreachable art nobody ever saw. Mixing here rather than folding at each
    # use, so every slice of the word is independently usable.
    x^=x>>16; x=(x*2246822507)&0xFFFFFFFF; x^=x>>13; x=(x*3266489909)&0xFFFFFFFF; x^=x>>16
    return x
def rgb(h,s,v): return tuple(int(c*255) for c in colorsys.hsv_to_rgb(h%1.0,s,v))

def jit(seed,k):
    """Independent 0..1 draw per (seed, k). Re-hashing with a suffix rather than slicing one word,
    so a motif can take several draws without them correlating with each other or the palette."""
    return (fnv(f'{seed}/{k}')&0xFFFF)/65535.0

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
    mono=(n%100)<66
    g=lambda v: rgb(0,0,v)
    if mono:
        # Drawn per seed rather than fixed. As constants, two mono covers sharing a motif were the
        # same picture pixel for pixel, and with 24 covers over 6 motifs that repeat is the first
        # thing the eye catches on a shelf. The bands keep bg/ink far apart so contrast holds.
        if dark: bg=g(0.10+0.06*jit(seed,1)); ink=g(0.66+0.16*jit(seed,2)); alt=g(0.32+0.18*jit(seed,3))
        else:    bg=g(0.86+0.09*jit(seed,1)); ink=g(0.09+0.13*jit(seed,2)); alt=g(0.42+0.20*jit(seed,3))
    elif dark:   bg=rgb(hue,0.68,0.26); ink=rgb(hue+0.07,0.72,0.70); alt=rgb(hue+0.48,0.52,0.52)
    else:        bg=rgb(hue,0.62,0.74); ink=rgb(hue+0.50,0.66,0.30); alt=rgb(hue+0.09,0.42,0.90)
    im=Image.new('RGB',(w,h),bg); d=ImageDraw.Draw(im,'RGBA')
    m=(n>>21)%6

    if m==0:                                             # big sun low on the field
        r=w*(0.52+0.16*jit(seed,4)); cy=h*(0.58+0.16*jit(seed,5))
        d.ellipse([w/2-r,cy-r,w/2+r,cy+r],fill=ink)
        ir=r*(0.30+0.22*jit(seed,6))
        d.ellipse([w/2-ir,cy-ir,w/2+ir,cy+ir],fill=alt)
    elif m==1:                                           # concentric rings
        nr=6+int(3*jit(seed,4)); step=0.72/nr
        cx,cy=w*0.5,h*(0.40+0.14*jit(seed,5))
        for i in range(nr):
            r=w*(0.72-i*step)
            d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=ink if i%2==0 else bg)
        er=w*(0.06+0.04*jit(seed,6))
        d.ellipse([cx-er,cy-er*1.4,cx+er,cy+er*1.4],fill=alt)
    elif m==2:                                           # wave bands, opaque
        # Opaque, not alpha-over-background: translucent bands blended with a saturated ground
        # into greys and olives that looked like a printing fault rather than a design.
        cols=[ink,alt,bg,ink]
        for b in range(4):
            base=h*(0.16+0.10*jit(seed,4))+b*h*0.19; amp=h*(0.03+0.045*jit(seed,5)); pts=[]
            freq=1.6+1.4*jit(seed,6); phase=6.283*jit(seed,7)
            for x in range(0,w+1,4):
                pts.append((x, base+math.sin(x/w*math.pi*freq+b*1.3+phase)*amp))
            pts += [(w,h),(0,h)]
            d.polygon(pts, fill=cols[b])
    elif m==3:                                           # halftone, non-merging
        rows=9+int(4*jit(seed,4)); cols_n=7+int(3*jit(seed,5))
        sx,sy=w*0.92/cols_n,h*0.90/rows
        for row in range(rows):
            for col in range(cols_n):
                # Cap the radius under half the spacing so the largest dots stay separate instead
                # of fusing into a solid block at the foot of the cover.
                r=min(1.5*SS+row*1.7*SS, min(sx,sy)*0.46)
                cx,cy=w*0.09+col*sx, h*0.08+row*sy
                d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=ink)
    elif m==4:                                           # overlapping discs, opaque
        j=jit(seed,4); k=jit(seed,5); rr=0.26+0.09*jit(seed,6)
        for fx,fy,fr,c in [(0.26+0.12*j,0.28+0.12*k,rr,ink),
                           (0.62+0.12*k,0.38+0.12*j,rr,alt),
                           (0.44+0.14*j,0.62+0.14*k,rr*0.94,ink)]:
            r=w*fr; cx,cy=w*fx,h*fy
            d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=c)
    else:                                                # nested arches
        na=3+int(3*jit(seed,4)); gap=w*(0.075+0.035*jit(seed,5))
        for i in range(na):
            pad=w*(0.07+0.07*jit(seed,6))+i*gap
            top=h*(0.12+0.10*jit(seed,7))+i*h*0.11
            # Run the bottom well past the canvas: rounding both ends left a keyhole-shaped gap
            # at the foot of the cover.
            if w-2*pad<=0: break
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
