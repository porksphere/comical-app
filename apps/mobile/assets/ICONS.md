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
`ko-mark`, `book-pages`, `book-cover`), with a neutral group shadow and
translucency. Expo consumes it via `ios.icon`.

**The background is the only thing that changes between appearances** — the
same three layers are used throughout. iOS is the only platform with a real
light/dark app-icon mechanism, so this split is iOS-only: the Android adaptive
background, `icon.png` and the favicon stay dark everywhere.

| appearance | background |
|------------|------------|
| Default / light | `solid extended-srgb:1,1,1,1` = **white** |
| Dark | `automatic-gradient extended-srgb:0.07843,…,1` = **`#141414`** |
| Clear / Tinted | system-derived, no fill of ours |

Encoded as a top-level `fill` plus a `fill-specializations` array of
`{ appearance, value }` entries — the schema says `fill` applies only "when
fill-specializations is not present", so **`light` is listed explicitly**
rather than left to fall through to `fill`, and `fill` is kept as the
matching white so either reading gives a white light icon. Validate edits
against Apple's schema (`icon-schema.json`, bundled in giginet/
apple-icon-composer-skill) rather than eyeballing them.

Light uses `solid` where dark uses `automatic-gradient` on purpose: an
automatic gradient *derives* its ramp from the base color, and what it derives
from pure white can't be previewed anywhere but macOS — so the light
appearance takes the deterministic fill and is exactly white. The mark
survives on white because the graphite cover frames it; the pages read as
light gray inside that frame rather than dissolving into the background.

Clear/Tinted are system-derived from the layers' luminance/alpha — the white
pages carry the silhouette and the dark こ knocks through it. `icon.json`
otherwise only changes if you add/remove/reorder layers — editing the SVGs'
contents needs no manifest change.

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

## The bridge mark (`images/comical-bridge.svg` → `.png`)

A **separate icon, not a derivative of the app icon** — the only asset here that
isn't. It stands for the synthetic cross-bridge "Comical" bridge
(`COMICAL_BRIDGE_ID` in `src/data/selected-bridge.ts`), which is a front door
listed alongside real bridges, and it is wired up as `COMICAL_ICON` — nothing
else uses it.

It exists because of where it renders: `BridgeThumbSize` is **28pt**, beside real
bridges' thumbnails, which are full-bleed square site logos. The full book at
28pt is mush — the page gradients, the halftone and the こ all collapse into a
gray smudge. So this is **just the こ**, taken from `logo.svg` (same outlined Yu
Gothic Bold path, transformed only — never re-outlined), scaled to 62% of the
frame and re-centered on its own bounding box (measured: x 350–678, y 297–659 in
the 1024 space, so centre 514,478 — not 512,512).

Two things it deliberately does differently from the app icon:

- **Full-bleed tile, light-on-dark.** `#2E2E2E → #141414` at 135° with an
  `#F5F5F5` glyph. A white tile would vanish into the light theme's `#ffffff`
  background while every neighbouring bridge shows a bounded square; dark-on-light
  keeps a defined edge on `#ffffff` **and** stays legible on the dark theme's
  `#000000`.
- **No baked-in corner radius.** The call sites clip it — `bridgeThumb`
  (borderRadius 8) in the Browse top bar, `optionThumb` (6) in the selector — the
  same way they clip remote thumbnails. Keep the art square.

No halftone: it's invisible at 28pt and only adds noise. Rasterize to
`comical-bridge.png` at **256** (RGB, opaque — it's a full-bleed tile), which
covers 28pt at 3x with room to spare. Same renderer as the table above.

The app logo still serves the larger surfaces — the 84pt splash mark and the
128pt "no bridges yet" onboarding both stay on `comical-logo.png`.

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

`#208AEF` — the OLD splash/logo blue — still survives in four places, and none
of them is a live token: a button in `error-boundary.tsx`, the `dev-profiler.tsx`
toggle, and `tintColor` in the four SideStore/AltStore source manifests under
`.github/` (`build-ios.yml`, `build-ios-devclient.yml`,
`refresh-ios-pr-source.sh`, `refresh-ios-release-source.sh`).

It is **not** the app's accent. The accent is `#3478F6` (`constants/theme.ts`,
hardcoded alongside it in a dozen components). `#208AEF` only ever matched the
old blue logo, so every remaining use is a stale leftover — decide each on its
own merits rather than treating it as brand color.
