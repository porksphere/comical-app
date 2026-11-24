#!/usr/bin/env python3
"""Build the mock catalog's covers and manga pages from their published sources.

    python3 scripts/build-mock-art.py [--cache DIR]

Writes apps/mobile/assets/mock/{covers,covers-varied,works,pages,pages-manga,bridges}/. The output is committed;
rerun only to change the selection or the crops. `apps/mobile/assets/mock/README.md` carries each
work's licence and credit, and has to be kept in step with the tables below.

Sources are downloaded into the cache (default: .cache/mock-art, gitignored) and reused. Wikimedia
throttles hard, so its files are fetched one at a time with a pause. The Black Jack volume is a
400MB archive and needs poppler's `pdftoppm` on the path.

Needs Pillow.
"""
import argparse
import io
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'apps', 'mobile', 'assets', 'mock')
UA = 'comical-mock-art/1.0 (fixture build script)'

# 2:3 at the height Pepper&Carrot publishes its textless episode art, so nothing is upscaled.
W, H = 510, 765

# Pepper&Carrot episode covers without lettering, as (episode, horizontal centre of the 2:3 crop).
# The art is landscape, so each cover is a portrait window onto it. The episode numbers are also
# `COVER_EPISODES` and `VARIED_COVER_EPISODES` in mock-works.ts, which names each cover's series
# after its episode: keep the lists in step.
#
# Ordered so that file `k` belongs to palette family `k % 6` (blue sky, warm, green, pale, red,
# night). `walkShelf` in mock.ts deals one family after another, which is what keeps two
# neighbours on a shelf from being the same colour.
COVERS = [
    (3, .52), (6, .55), (7, .42), (5, .55), (24, .62), (33, .30),
    (11, .47), (19, .42), (17, .60), (22, .50), (26, .52), (38, .78),
    (16, .50), (31, .50), (20, .20), (23, .62), (13, .40), (30, .72),
    (14, .62), (37, .55), (1, .42), (25, .50), (2, .30), (29, .45),
]

# The episodes whose covers are not a uniform 2:3, for the one bridge that serves those:
# (episode, centre, width, height). The shapes run tall to wide and round again.
COVERS_VARIED = [
    (32, .50, 510, 765),
    (18, .50, 510, 680),
    (9, .45, 510, 595),
    (34, .50, 510, 510),
    (39, .50, 510, 374),
    (4, .72, 510, 765),
    (8, .60, 510, 680),
    (12, .55, 510, 595),
    (15, .30, 510, 510),
    (21, .50, 510, 374),
    (27, .45, 510, 595),
    (28, .50, 510, 374),
    (35, .55, 510, 510),
    (36, .30, 510, 680),
]

# Covers that carry their own title: the named works in mock-works.ts (`NAMED_WORKS`).
COMMONS = {
    'planet-comics': 'Planet Comics no. 1 (high-res).jpg',
    'wonderworld-comics': 'WonderworldComics3.jpg',
    'fantastic-comics': 'Fantastic Comics no. 3.jpg',
    'pepper-and-carrot': '2018-11-22 vertical-cover-book-three by-David-Revoy.jpg',
}

# Pepper&Carrot's own pages, English lettering, as (episode, page). Episode 1 whole; episode 2
# without its fifth page (a bath scene, fine in context and an odd thing to lead a README with)
# or its closing page, which is the patron credits rather than comic art.
PAGES = [(2, 1), (2, 2), (2, 3), (2, 4), (1, 3), (1, 1), (1, 2)]

# The mock bridges are named for the official registry's server bridges, and each wears the logo
# of the server it is named for, from that project's own repository or site.
BRIDGE_ICONS = {
    'komga': 'https://raw.githubusercontent.com/gotson/komga/master/komga-webui/public/android-chrome-192x192.png',
    'kavita': 'https://raw.githubusercontent.com/Kareadita/Kavita/develop/UI/Web/src/assets/icons/android-chrome-192x192.png',
    'suwayomi': 'https://raw.githubusercontent.com/Suwayomi/Suwayomi-Server/master/server/src/main/resources/icon/faviconlogo.png',
    'lanraragi': 'https://raw.githubusercontent.com/Difegue/LANraragi/dev/public/img/logo.png',
    'opds': 'https://opds.io/apple-touch-icon.png',
}
ICON = 128

BLACK_JACK_ZIP = 'https://densho810.com/free/dl/enbj001.zip'
BLACK_JACK_COVER_PAGE = 1
# Volume 1, English. Pages 8 and 9 are an operation shown open and 17 onward a road accident; these
# are the hospital's corridors and night office.
BLACK_JACK_PAGES = [7, 10, 11, 12, 13, 14, 15, 16]
PAGE_WIDTH = 800


def fetch(url, dst, pause=0.3):
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    print(f'  fetch {url}')
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=1800) as r, open(dst + '.part', 'wb') as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(dst + '.part', dst)
    time.sleep(pause)
    return dst


def save(im, subdir, name):
    out = os.path.join(OUT, subdir)
    os.makedirs(out, exist_ok=True)
    dst = os.path.join(out, name)
    im.save(dst, 'JPEG', quality=82, optimize=True, progressive=True)
    return os.path.getsize(dst)


def window(im, cx, w, h):
    """The largest w:h window of `im`, centred horizontally on `cx`, resized to w x h."""
    im = im.convert('RGB')
    iw, ih = im.size
    if iw / ih > w / h:
        cw = round(ih * w / h)
        x = min(max(round(cx * iw - cw / 2), 0), iw - cw)
        im = im.crop((x, 0, x + cw, ih))
    else:
        ch = round(iw * h / w)
        y = (ih - ch) // 2
        im = im.crop((0, y, iw, y + ch))
    return im.resize((w, h), Image.LANCZOS)


def pepper_carrot(cache):
    index = fetch('https://www.peppercarrot.com/0_sources/episodes-v1.json', os.path.join(cache, 'pc', 'episodes.json'))
    episodes = json.load(open(index))

    def art(ep):
        e = episodes[ep - 1]
        url = f"https://www.peppercarrot.com/0_sources/{e['name']}/hi-res/gfx-only/gfx_{e['pages']['cover']}"
        return Image.open(fetch(url, os.path.join(cache, 'pc', f'gfx-E{ep:02d}.jpg')))

    total = 0
    for k, (ep, cx) in enumerate(COVERS):
        total += save(window(art(ep), cx, W, H), 'covers', f'{k:02d}.jpg')
    print(f'  covers/: {len(COVERS)} files, {total // 1024} KB')
    total = 0
    for k, (ep, cx, w, h) in enumerate(COVERS_VARIED):
        total += save(window(art(ep), cx, w, h), 'covers-varied', f'{k:02d}.jpg')
    print(f'  covers-varied/: {len(COVERS_VARIED)} files, {total // 1024} KB')

    out = os.path.join(OUT, 'pages')
    os.makedirs(out, exist_ok=True)
    total = 0
    for k, (ep, n) in enumerate(PAGES):
        e = episodes[ep - 1]
        url = f"https://www.peppercarrot.com/0_sources/{e['name']}/low-res/en_{e['pages'][str(n)]}"
        im = Image.open(fetch(url, os.path.join(cache, 'pc', f'page-E{ep:02d}P{n:02d}.jpg'))).convert('RGB')
        dst = os.path.join(out, f'{k:02d}.jpg')
        im.resize((PAGE_WIDTH, round(im.height * PAGE_WIDTH / im.width)), Image.LANCZOS).save(dst, 'JPEG', quality=64, optimize=True)
        total += os.path.getsize(dst)
    print(f'  pages/: {len(PAGES)} files, {total // 1024} KB')


def commons(cache):
    total = 0
    for name, title in COMMONS.items():
        dst = os.path.join(cache, 'commons', name + '.jpg')
        if not os.path.exists(dst):
            # 960 is one of the widths Wikimedia serves without a per-request render; any other
            # is refused once a client has asked for a few.
            query = urllib.parse.urlencode({
                'action': 'query', 'format': 'json', 'titles': 'File:' + title,
                'prop': 'imageinfo', 'iiprop': 'url', 'iiurlwidth': 960,
            })
            req = urllib.request.Request('https://commons.wikimedia.org/w/api.php?' + query, headers={'User-Agent': UA})
            pages = json.load(urllib.request.urlopen(req, timeout=60))['query']['pages']
            time.sleep(8)
            fetch(next(iter(pages.values()))['imageinfo'][0]['thumburl'], dst, pause=8)
        total += save(window(Image.open(dst), .5, W, H), 'works', name + '.jpg')
    print(f'  works/: {len(COMMONS)} files from Wikimedia Commons, {total // 1024} KB')


def bridge_icons(cache):
    out = os.path.join(OUT, 'bridges')
    os.makedirs(out, exist_ok=True)
    total = 0
    for name, url in BRIDGE_ICONS.items():
        im = Image.open(fetch(url, os.path.join(cache, 'bridges', name + '.png'))).convert('RGBA')
        dst = os.path.join(out, name + '.png')
        im.resize((ICON, ICON), Image.LANCZOS).save(dst, 'PNG', optimize=True)
        total += os.path.getsize(dst)
    print(f'  bridges/: {len(BRIDGE_ICONS)} files, {total // 1024} KB')


def black_jack(cache):
    pdf = os.path.join(cache, 'bj', 'enbj001.pdf')
    if not os.path.exists(pdf):
        archive = fetch(BLACK_JACK_ZIP, os.path.join(cache, 'bj', 'enbj001.zip'))
        with zipfile.ZipFile(archive) as z:
            member = next(i for i in z.infolist() if i.filename.lower().endswith('.pdf'))
            with z.open(member) as src, open(pdf, 'wb') as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
        os.remove(archive)

    def page(n, gray):
        args = ['pdftoppm', '-f', str(n), '-l', str(n), '-scale-to-x', str(PAGE_WIDTH), '-scale-to-y', '-1', '-png']
        raw = subprocess.run(args + (['-gray'] if gray else []) + [pdf], check=True, capture_output=True).stdout
        return Image.open(io.BytesIO(raw))

    size = save(window(page(BLACK_JACK_COVER_PAGE, False), .5, W, H), 'works', 'black-jack.jpg')
    print(f'  works/black-jack.jpg: {size // 1024} KB')
    out = os.path.join(OUT, 'pages-manga')
    os.makedirs(out, exist_ok=True)
    total = 0
    for k, n in enumerate(BLACK_JACK_PAGES):
        dst = os.path.join(out, f'{k:02d}.jpg')
        page(n, True).convert('L').save(dst, 'JPEG', quality=58, optimize=True)
        total += os.path.getsize(dst)
    print(f'  pages-manga/: {len(BLACK_JACK_PAGES)} files, {total // 1024} KB')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--cache', default=os.path.join(ROOT, '.cache', 'mock-art'))
    cache = os.path.abspath(parser.parse_args().cache)
    pepper_carrot(cache)
    commons(cache)
    bridge_icons(cache)
    black_jack(cache)


if __name__ == '__main__':
    sys.exit(main())
