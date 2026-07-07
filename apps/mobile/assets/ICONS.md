# App icon & logo assets

How the Comical logo and every derived icon are produced. There is **no build
script** — this is the manual recipe. `logo.svg` is the master; everything else
is derived from it by hand and must be kept in sync when the art changes.

## Source of truth

**`images/logo.svg`** — the full-color master: an open book (blue cover + light
pages) with a translucent こ. It contains five drawn elements and five gradient
defs:

| element | fill | notes |
|---------|------|-------|
| cover `<rect>` | `#cover` | rounded book cover, 2-stop `#6EA8F7 → #3266DC` |
| left page `<path>` | `#leftPage` | |
| right page `<path>` | `#rightPage` | |
| binding shadow `<path>` | `#bindingShadow` | thin gradient down the spine |
| こ `<path>` | `#koMark`, `opacity 0.58` | see "The こ glyph" below |

Everything is authored in a **1024×1024** viewBox. Edit this file first; then
propagate to the derived files below.

## The こ glyph (one-time, already done)

The こ is **not live text** — it's a static vector outline, so no CJK font is
needed to render the art. It was outlined **once** from **Yu Gothic Bold**
(`YuGothB.ttc`, `fontNumber=0`) with fontTools (`getGlyphSet()` → `SVGPathPen`),
positioned to match `<text x="512" y="660" font-size="500" font-weight="800">こ</text>`.
The resulting `<path d="M376.99…Z">` is pasted into `logo.svg` (and reused in
`ko-mark.svg` and `logo-mark.svg`). You only need to redo this if you change the
glyph, font, size, or position — otherwise leave the path as-is.

## Derived files (keep in sync with logo.svg by hand)

Each is a straight subset/recolor of `logo.svg`. When you change geometry or a
gradient in `logo.svg`, make the matching edit here.

- **`expo.icon/Assets/book-cover.svg`** — cover `<rect>` + `#cover` def only.
- **`expo.icon/Assets/book-pages.svg`** — left/right page + binding-shadow paths
  + their three defs.
- **`expo.icon/Assets/ko-mark.svg`** — the こ path + `#koMark` def only.
- **`images/logo-mark.svg`** — **monochrome mask.** The left page `d` + right
  page `d` + こ `d` concatenated into one `<path fill="#FFFFFF"
  fill-rule="evenodd">`. Evenodd makes the こ knock out as holes. The cover rect
  and binding shadow are intentionally excluded (silhouette = pages + glyph).
  Feeds the Android themed icon and iOS tinted/clear appearances.

### The iOS 26 layered icon (`expo.icon/icon.json`)

Icon Composer manifest. It references the three layer SVGs above (top→bottom:
`ko-mark`, `book-pages`, `book-cover`) over a solid light-blue fill
(`automatic-gradient extended-srgb:0.85882,0.91765,0.99608,1` = `#DBEAFE`), with
a neutral group shadow and translucency. Expo consumes it via `ios.icon`;
Default/Dark use the color layers, Clear/Tinted are system-derived from their
luminance/alpha. `icon.json` itself only changes if you add/remove/reorder
layers — editing the SVGs' contents needs no manifest change.

## Rasterized PNGs (regenerate when logo.svg changes)

All live in `images/`. Each is the master (or the mono mask) placed on a
background at a fixed **scale of the frame** and exported at a fixed size. Scale
= art size ÷ frame size; the art is centered.

| file | size | source | scale | background | mode |
|------|------|--------|-------|------------|------|
| `icon.png` | 1024 | logo.svg | 0.90 | gradient | RGB (opaque) |
| `favicon.png` | 196 | logo.svg | 0.94 | gradient | RGB (opaque) |
| `comical-logo.png` | 512 | logo.svg | 1.00 | none | RGBA |
| `splash-icon.png` | 512 | logo.svg | 1.00 | none | RGBA |
| `android-icon-background.png` | 1024 | — | — | gradient | RGB (opaque) |
| `android-icon-foreground.png` | 1024 | logo.svg | 0.72 | none | RGBA |
| `android-icon-monochrome.png` | 1024 | logo-mark.svg | 0.72 | none | RGBA |

- **Background gradient** (opaque tiles): linear **135°**, `#EFF6FF` (top-left) →
  `#DBEAFE` (bottom-right).
- **0.72** for the Android foreground/monochrome keeps the art inside the
  adaptive-icon safe zone (center ~66–72%).
- **`logo-glow.png`** is a separate hand-made asset — **not** regenerated here.

### How to render

Any deterministic SVG→PNG rasterizer works; the art uses only rects, paths, and
linear gradients. The last regeneration used **headless Chrome** — for each row,
an HTML frame of the target size with the CSS background above and an
`<img src="logo.svg">` sized to `scale × frame`, centered, screenshotted at
device-scale-factor 1 with a transparent default background:

```
chrome --headless --disable-gpu --force-device-scale-factor=1 \
  --window-size=SIZE,SIZE --default-background-color=00000000 \
  --hide-scrollbars --user-data-dir=<fresh temp dir> \
  --screenshot=out.png file:///frame.html
```

Use a **fresh `--user-data-dir` per invocation** to avoid Chrome's profile-lock
race when looping. For the opaque rows, flatten the RGBA screenshot onto white
(or just author the background as an opaque SVG rect) so the saved file is RGB.
Match each file's exact size/mode from the table so nothing downstream (Expo
config, splash, web favicon) has to change.
```
