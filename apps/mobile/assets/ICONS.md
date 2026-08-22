# App icon & logo assets

How the Comical logo and every derived icon are produced. There is **no build
script** — this is the manual recipe. `logo.svg` is the master; everything else
is derived from it by hand and must be kept in sync when the art changes.

## Source of truth

**`images/logo.svg`** — the master: an open book (graphite cover + curved white
pages under a halftone screen) with a translucent こ. The art is authored on
**transparent** and is designed to sit on near-black; the background is supplied
by whatever composites it (see the raster table below). It contains six drawn
elements and four defs:

| element | fill | notes |
|---------|------|-------|
| cover `<rect>` | `#cover` | rounded book cover, 2-stop `#4A4A4A → #181818` |
| left page `<path>` | `#leftPage` | radial, bright at the top-left corner |
| right page `<path>` | `#rightPage` | radial, bright at the top-right corner |
| left tone `<path>` | `#pageTone`, `opacity 0.42` | same `d` as the left page |
| right tone `<path>` | `#pageTone`, `opacity 0.42` | same `d` as the right page |
| こ `<path>` | flat `#111111`, `opacity 0.76` | see "The こ glyph" below |

Everything is authored in a **1024×1024** viewBox. Edit this file first; then
propagate to the derived files below.

The halftone is screened on by **re-drawing each page path** with the
`#pageTone` pattern rather than clipping a rect to it — same result, but it
keeps the file free of `<clipPath>`/`<use>`, which the more limited SVG
importers (notably Icon Composer) do not all support. Keep it that way. The
tone is texture only: if a renderer drops `<pattern>`, the pages fall back to
their clean radial gradients and nothing looks broken.

## The こ glyph (one-time, already done)

The こ is **not live text** — it's a static vector outline, so no CJK font is
needed to render the art. It was outlined **once** from **Yu Gothic Bold**
(`YuGothB.ttc`, `fontNumber=0`) with fontTools (`getGlyphSet()` → `SVGPathPen`),
positioned to match `<text x="512" y="660" font-size="500" font-weight="800">こ</text>`.
The resulting `<path d="M376.99…Z">` is pasted into `logo.svg` (and reused in
`ko-mark.svg` and `logo-mark.svg`). You only need to redo this if you change the
glyph, font, size, or position — otherwise leave the path as-is.

## Derived files (keep in sync with logo.svg by hand)

Each is a straight subset of `logo.svg` — the `d`/`rect` geometry is copied
verbatim, so a change to a path in `logo.svg` is a mechanical copy-paste here.

- **`expo.icon/Assets/book-cover.svg`** — cover `<rect>` + `#cover` def only.
- **`expo.icon/Assets/book-pages.svg`** — both page paths + both tone paths +
  their three defs (`#leftPage`, `#rightPage`, `#pageTone`).
- **`expo.icon/Assets/ko-mark.svg`** — the こ path only.
- **`images/logo-mark.svg`** — **monochrome mask.** The left page `d` + right
  page `d` + こ `d` concatenated into one `<path fill="#FFFFFF"
  fill-rule="evenodd">`. Evenodd makes the こ knock out as holes. The cover rect
  and the halftone are intentionally excluded (silhouette = pages + glyph).
  Feeds the Android themed icon and iOS tinted/clear appearances.

### The iOS 26 layered icon (`expo.icon/icon.json`)

Icon Composer manifest. It references the three layer SVGs above (top→bottom:
`ko-mark`, `book-pages`, `book-cover`) over a solid near-black fill
(`automatic-gradient extended-srgb:0.07843,0.07843,0.07843,1` = `#141414`), with
a neutral group shadow and translucency. Expo consumes it via `ios.icon`;
Default/Dark use the color layers, Clear/Tinted are system-derived from their
luminance/alpha — the white pages carry the silhouette and the dark こ knocks
through it. `icon.json` itself only changes if you add/remove/reorder layers —
editing the SVGs' contents needs no manifest change.

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

- **Background gradient** (opaque tiles): linear **135°**, `#1C1C1C` (top-left) →
  `#000000` (bottom-right).
- **0.72** for the Android foreground/monochrome keeps the art inside the
  adaptive-icon safe zone (center ~66–72%).
- **`logo-glow.png`** is a separate hand-made asset — **not** regenerated here.
  It is a flat fill shaped entirely by its alpha ramp, so it is re-tinted (RGB
  replaced, alpha untouched) rather than redrawn when the palette changes; it is
  currently neutral `#DEDEDE`.

### How to render

Any deterministic SVG→PNG rasterizer works; the art uses only rects, paths,
gradients, and one pattern. The last regeneration used **Playwright + Chromium**,
one page per row, with the SVG inlined as a `data:` URI inside a frame div:

```js
const page = await browser.newPage({
  viewport: { width: size, height: size },
  deviceScaleFactor: 1,
});
await page.setContent(`<style>
  html,body{margin:0;padding:0}
  #f{width:${size}px;height:${size}px;background:${bg};
     display:flex;align-items:center;justify-content:center;overflow:hidden}
  img{width:${art}px;height:${art}px;display:block}
</style><div id="f"><img src="${dataUri}"></div>`);
await page.screenshot({ path: out, omitBackground: !opaque });
```

Two things to get right:

- **Set the viewport, not a window size.** Chrome's older `--headless
  --window-size=N,N` screenshot path reserves ~87px of window chrome, so the
  page viewport comes back *shorter* than the image and a full-size element is
  clipped along the bottom edge — with a transparent band left behind. Anything
  that sets the viewport directly (Playwright, `--headless=new` + CDP
  `Emulation.setDeviceMetricsOverride`) avoids this. Verify a regenerated tile
  paints all `size` rows before trusting it.
- **Inline the SVG as a `data:` URI.** A `setContent` page has an opaque origin
  and cannot load `file://` subresources, and inlining keeps each SVG's gradient
  and pattern ids scoped to its own image.

`omitBackground: true` gives the RGBA rows a truly transparent frame; the opaque
rows paint the gradient on the frame div itself, so they save as RGB. Match each
file's exact size/mode from the table so nothing downstream (Expo config,
splash, web favicon) has to change.

## Colors that track the logo

The near-black palette is mirrored by the app's splash chrome, which must stay
in sync with the icon backgrounds:

- `app.json` → `expo-splash-screen.backgroundColor` = `#0B0B0B` (native splash).
- `src/components/animated-icon.tsx` → `backgroundSolidColor` = `#0B0B0B`. This
  **must** equal the native splash color: the JS overlay takes over from the
  native splash mid-launch and any mismatch shows as a flash.
- The rounded tile behind the animated logo — `animated-icon.tsx`
  (`experimental_backgroundImage`) and `animated-icon.module.css`
  (`.expoLogoBackground`) — is `linear-gradient(180deg, #242424, #050505)`.
  Keep the two in sync; they are the native and web halves of one component.
- `app.json` → `android.adaptiveIcon.backgroundColor` = `#000000`.

The `#208AEF` left in `error-boundary.tsx` and `dev-profiler.tsx` is the app's
**accent** color on buttons, not logo chrome — unrelated to this palette.
