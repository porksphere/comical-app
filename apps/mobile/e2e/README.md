# comical-app end-to-end tests (Maestro)

The same journey, written once for mobile and once for web, drives web, Android, and iOS. Runs
locally, and in CI **on demand only** — `.github/workflows/e2e.yml` is `workflow_dispatch`-only
(`gh workflow run e2e.yml --ref <branch>`), because on GitHub's runners the suite failed often
enough for reasons unrelated to the change under test that a red X stopped meaning anything. Run
it deliberately when you've touched something it covers; don't expect it to catch things for you.

## Why Maestro

Maestro flows are plain YAML, select elements by `id:` (matched to `accessibilityIdentifier` on
iOS, `resource-id` on Android, and `data-testid` on web via react-native-web), and — as of the
Beta web support Maestro shipped in 2025/2026 — run against Android, iOS, *and* a managed
Chromium browser from the exact same flow format. That `id:` selector is precisely this app's
existing `testID` convention (`src/lib/test-id.ts`). No custom adapter/interpreter exists in this
repo, and none is needed — Maestro itself is the adapter.

## Layout

```
e2e/
  mobile/    # committed flows — appId: com.porksphere.comical + steps. Covers BOTH Android and
             # iOS: they share the same bundle id, and Maestro targets whichever device/
             # emulator/simulator is currently connected, not anything encoded in the file.
  web/       # committed flows — url: http://localhost:4000 + steps. Same journeys as mobile/,
             # kept in sync by hand (see "Why two copies, not one" below).
  config/    # one Maestro workspace config per platform (execution order, flow glob):
             # android.yaml and ios.yaml both point at ../mobile/*.yaml; web.yaml at ../web/*.yaml.
  scripts/
    run-device.sh   # local runner: reconnects a dev-client build to Metro, then runs a flow
```

### Why two copies, not one shared body

Maestro requires **every** flow file to declare its own `appId`/`url` in a real config section —
this is true even for a file that's only ever reached via `runFlow:` (confirmed empirically: an
empty or missing config section fails with `Config Section Required` / `Config Field Required`).
So a single flow body can't be platform-agnostic the way a plain `testID`-selecting step list
otherwise could be. The practical floor this gives us:

- **Android and iOS share one copy** (`mobile/`) — they use the identical `appId`
  (`com.porksphere.comical`), so nothing platform-specific needs to differ in the file at all.
- **Web needs its own copy** (`web/`) — it needs `url:` instead of `appId:`. The steps below the
  `---` are identical to the `mobile/` version; keep them in sync by hand when editing either.

This is real, Maestro-imposed duplication (config header + a copy of the steps), not a design
choice — the previous `flows/` + thin per-platform-entrypoint (`runFlow:`) approach this repo
tried first does **not** work: subflow files still need their own appId/url, so the "thin
entrypoint" layer added an extra file without removing the duplication. Two copies (mobile, web)
is the actual minimum, not three.

## Data: demo/mock mode only

Every CI build in this suite is built with `EXPO_PUBLIC_COMICAL_DEMO_MODE=1` — fully client-side
mock data (`src/data/mock.ts`), no host-server or bridge involved. This is deliberate: it keeps
flows deterministic and fast, and means PRs from external contributors never trigger live
scraping-adjacent bridge traffic. A flow should never depend on data that only a real backend
would produce.

## Web: static export, not the live Metro dev server

CI (and the local instructions above) build web with `bunx expo export --platform web` rather
than `expo start --web` — deterministic (matches what a real build renders, no HMR overhead
irrelevant to a one-shot test) and trivially health-checked. `app.json`'s
`experiments.baseUrl: "/comical-app"` is baked unconditionally into every export's asset paths
(`/comical-app/_expo/static/js/...`, not relative), so the exported `dist` must be served *under*
a `/comical-app`-named subdirectory of whatever's serving it, not at the served root — otherwise
every JS/CSS asset 404s and the app never renders. `web/smoke.yaml`'s `url:` and `e2e.yml`'s
`test-web` job both already account for this; keep it in mind if you add a new web flow or change
how the export is served.

## Platform divergence

Most screens render identical testIDs on every platform (the custom tab bar in `app-tabs.tsx`
does, for instance), so most flow *bodies* need no platform branching at all — `mobile/` and
`web/` are line-for-line the same journey. Selectors are a different story on web, though (see
next section). When a screen's actual *behavior* genuinely differs (e.g. a desktop-only sidebar
column), branch *inside* a flow body with Maestro's `when: { platform: ... }` conditional steps —
check current syntax at https://docs.maestro.dev before relying on it, Maestro's flow schema
evolves.

## Web-only selector quirk: aria-label beats data-testid

Confirmed empirically against Maestro 2.6.1's web/Chromium beta support: when a react-native-web
element has **both** a `testID` (→ `data-testid`) and an explicit `accessibilityLabel`
(→ `aria-label`) on the same DOM node, Maestro's web hierarchy walker resolves that element's
matchable `id:` field to the aria-label text, not `data-testid` — `data-testid` is only used when
no competing `aria-label` exists on that node. Android/iOS are unaffected (they map
`testID`/`accessibilityIdentifier` directly, no aria-label involved).

This hits every `Pressable` in the codebase that sets `accessibilityRole="button"` +
`accessibilityLabel` alongside its `testID` — a common, deliberate a11y pattern here, **not**
limited to icon-only controls. Confirmed cases so far: the tab bar (`app-tabs.tsx`'s `TabButton`),
Settings' category rows, `series.cover` (app/series.tsx — note its label is the dynamic
`primaryLabel`, not a fixed string, so it can't be selected by label text at all; anchor on
`series.action.read`/`ActionButton` instead, which has no competing label), `reader.toolbar.back`
(label `"Close reader"`), `browse.search-icon`/`browse.search-pill` (both label `"Search"` — same
text either way, so one selector covers whichever layout renders), and `search.field.clear` (label
`"Clear search"`). `mobile/*.yaml` selects all of these by testID (Android/iOS have no aria-label
involved); the `web/*.yaml` copies for the same flows select by the label text instead — see
`browse-to-reader.yaml`/`search.yaml` for worked examples, and `web/smoke.yaml` for the tab
bar/Settings case. Plain testIDs with no `accessibilityLabel` prop at all (`browse\..*`,
`library\..*`, `screen-title.*`, `series\.chapter\..*`, `series.action.*`) are unaffected — same
selector on both platforms.

**Don't assume either way for a new selector** — grep the component for a co-located
`accessibilityLabel` before writing a web flow, or dump the failing run's debug hierarchy JSON
(`C:\Users\<you>\.maestro\tests\<timestamp>\commands-*.json` → `metadata.error.hierarchyRoot`) and
check whether the element's `resource-id` is label text rather than the testID.

Two more cases confirmed while writing `downloads.yaml`, both worth knowing about generally:

- **Select by `id:`, not `text:`, for an aria-label match.** Maestro's `text:` matcher checks
  rendered DOM text; an `accessibilityLabel`/`aria-label` isn't rendered text at all, so `text:`
  never matches it even when the element is plainly on screen — only `id:` resolves through the
  aria-label path described above. Confirmed the hard way: an initial `text:`-based attempt at
  `select-mode.tsx`'s `SelectOptionsButton` (static label `"Selection options"`) and its
  `SelectPillBar` verb pills (dynamic label, e.g. `"Download 40 chapters"` — matched with a regex
  `id:`, the same precedent as `series.tracker.result.<id>`) both failed until switched to `id:`.
- **A combined `assertVisible`/`extendedWaitUntil` (`id: + text:`) requires both to match the SAME
  hierarchy node** — not a node plus one of its descendants. `ActionButton`
  (`components/series/action-button.tsx`) sets `testID` on the outer `Pressable` but renders its
  label in a separate child `Text` node; the testID'd node itself carries no `text` attribute in
  Maestro's hierarchy dump. An `assertVisible: {id: "series.action.download", text: "..."}`-style
  combo therefore never matches, regardless of whether either condition alone is correct — confirmed
  via a hierarchy-JSON dump showing the label two levels below the testID'd node. Fix: drop the
  `id:` constraint and assert on a bare `text:` regex when the string is unambiguous on that screen
  (see `downloads.yaml`'s final assertion in both mobile copies for a worked example). Confirmed to
  affect the same testID/child-Text split beyond `ActionButton` too: `tab-badge.tsx` (fixed in
  `history-activity.yaml`) and `progress-pill.tsx`'s closed pill (fixed in `reader-navigation.yaml` back when
  that flow read the page off the pill — it reads the toolbar subtitle now)
  both hit it — audit any *new* `id: + text:` combo against the component's actual JSX structure
  before assuming it'll resolve on Android.

## Web-only gesture quirk: a tap inside an OverlaySheet can misfire as drag-to-dismiss

Confirmed empirically (local Maestro-web run + debug screenshots) while writing
`series-trackers.yaml`: tapping `series.tracker.link-toggle` — a plain `Pressable` with no gesture
of its own, inside the Trackers bottom sheet — closed the sheet instead of triggering its
`onPress`. Root cause is in `components/overlay/overlay.tsx`, not the tapped screen:
`OverlaySheet`'s `contentPan` `Gesture.Pan()` wraps the *entire* sheet body with
`activeOffsetY(12)`, chaining into dismiss once the inner content is scrolled to the top and the
drag continues downward. Maestro-web's synthetic tap apparently isn't a stationary
mousedown/mouseup at one point — when the tap target sits well below the previous tap's position,
the pointer travel is enough to cross that 12px threshold, so the pan gesture wins the race against
the Pressable's own `onPress` and the sheet just dismisses. Not reproducible as a real bug: an
actual user's tap doesn't travel that far.

**Any web flow that taps content inside an `OverlaySheet` body (Trackers, Sources, registries.add,
manage-collections.add, filter sheets, …) is at risk of this** — not just multi-step swipe/pinch
gestures, which were already known to be unreliable on Maestro-web. Treat that class of flow as
mobile-only. Confirmed a second time and a second way while writing `registries-collections.yaml`:
tapping `registries.add.url-input` (a plain `TextInput`, no gesture of its own) inside the "Add
registry" sheet closed it before any text was even typed — a screenshot taken immediately after
the tap already shows the plain Registries screen underneath, sheet gone. That timing rules out
the original pointer-travel theory as the *only* cause: this sheet's `TextInput` sits right where
it was tapped from, no distant-target travel involved. The likelier trigger here is
`useKeyboardAvoidingInput`'s `onFocus` handler, which repositions the sheet (dodging where a
keyboard would go) the instant the input focuses — that programmatic `translateY` shift, landing
mid-gesture, reads to `contentPan`'s Pan responder as motion past its 12px activation threshold,
same net effect (dismiss) as the pointer-travel case, different mechanism. Both are plausible
instances of the same underlying fragility (a Pan responder wrapping the whole sheet body reacting
to *any* motion signal, real or programmatic, that arrives while a tap is in flight) rather than
one root cause — don't assume a fix for one variant covers the other.

**Not every overlay is an `OverlaySheet`, though — `collection-picker.tsx`'s "Add to collection" popup is a
false alarm for this quirk, not a match for it.** It's a screen-specific floating card
(`HostPopup`) with no `Gesture.Pan`/`GestureDetector` anywhere in the component — dismissed only by
a plain `Pressable` backdrop or its Done button — confirmed both by reading the source and by a
real local web run tapping straight through `collection-picker.new` → `collection-picker.new-name` → typing →
Enter, which stayed open and created the list correctly. `registries-collections.yaml`'s web copy
exercises exactly this path while staying mobile-only for the sheet-based `registries.add` /
`manage-collections.add` sub-flows in the same source screen. Check what a given overlay actually renders
with (`useOverlay()`'s `open`/`openAt` → `OverlaySheet`/`OverlayPopover`, vs. a bespoke component
like `collection-picker.tsx`) before assuming either way.

## Running locally

**Android / iOS (dev-client, Metro-connected):**
```
bun run dev:device                                   # start Metro, from apps/mobile
bash e2e/scripts/run-device.sh android smoke.yaml     # one flow
bash e2e/scripts/run-device.sh android                # every flow, in order
bash e2e/scripts/run-device.sh ios smoke.yaml
```
Requires the dev-client build already installed (`expo run:android` / the `ios-devclient`
SideStore channel — see repo root docs) and Maestro installed (below). Works against an
already-running dev server too — no need to start a second one if `bun run dev` is already up.

**Web** (a static `expo export`, not the live Metro dev server — see "Web: static export" below):
```
EXPO_PUBLIC_COMICAL_DEMO_MODE=1 bunx expo export --platform web   # from apps/mobile
mkdir -p /tmp/comical-e2e-web/comical-app && cp -r dist/. /tmp/comical-e2e-web/comical-app/
npx serve /tmp/comical-e2e-web -l 4000
maestro test e2e/web/smoke.yaml                                   # in a second terminal
```
The `/comical-app` subdirectory step matters — see "Web: static export" below for why.

**Run every flow for a platform in Maestro's own executionOrder** (what CI actually runs — a
single flow file, as above, ignores `config/*.yaml`'s `flowsOrder`):
```
maestro test --config e2e/config/android.yaml e2e/mobile
maestro test --config e2e/config/ios.yaml e2e/mobile
maestro test --config e2e/config/web.yaml e2e/web
```
Maestro's `--config` flag is a *workspace config* (execution order only) — the flow files
themselves still come from the `<flowFiles>` positional argument (a folder here), which is why
each config file has no `flows:` glob: one was tried and confirmed (empirically, Maestro 2.6.1)
to resolve relative to the CLI's cwd rather than the config file's own directory, so it silently
matched nothing when invoked from the repo root, as CI does.

**One-time Maestro setup:**
```
curl -Ls "https://get.maestro.mobile.dev" | bash
```
Add `~/.maestro/bin` to `PATH`, then `maestro --version`. On Windows use Git Bash or WSL2.

## Writing a new flow

1. `maestro hierarchy` against a running app dumps the live element tree (ids, labels, bounds) —
   use it to find selectors instead of guessing from a screenshot. `maestro studio` is the
   interactive equivalent.
2. The sibling `.maestro-local/` folder (gitignored, never committed — see its own README) is the
   scratch pad for this step: iterate there against a live dev-client build, then **promote** the
   finished flow into `mobile/<name>.yaml` (and `web/<name>.yaml` if it applies to web) once
   it's reliable. Don't skip straight to writing here for anything you haven't run at least once.
3. Every new user-facing screen or flow should get a flow here — see the root `AGENTS.md` and the
   PR template checklist. `apps/mobile/scripts/check-flow-coverage.mjs` (run in CI, advisory-only)
   flags new tab/screen-title testIDs that no committed flow references yet.

## Selector conventions (from `src/lib/test-id.ts`)

Dot-namespaced `area.element[.qualifier]`; list items suffix a stable domain id:
`tab.<route>`, `browse.search-icon`, `series-card.<seriesId>`, `series.cover`,
`series.chapter.<key>`, `reader.toolbar.back`, `settings.category.general`. Maestro treats `id:`
as a regex, so `series-card\\..*` matches the first card. Grep `src/` for `testID`/`testId(` to
find more.

## `demo/` — the README capture, not a test

`demo/demo.yaml` drives the same Browse → series → reader journey the flows above cover, but its
output is the animated GIF in the repo's README rather than a pass/fail. It sits in its own folder
on purpose: the suite configs discover flows by folder (`maestro test … e2e/mobile`), so a file
dropped in `mobile/` would run in CI under `continueOnFailure: false` and gate the real flows
behind a recording. `check-flow-coverage.mjs` only scans `e2e/{mobile,web}` for the same reason —
a promo capture shouldn't count as coverage of the screens it happens to pass through.

Two ways to run it:

```bash
bash apps/mobile/e2e/scripts/record-demo.sh ios       # or: android
gh workflow run capture-demo.yml --ref <branch>       # builds + records on a runner, uploads the GIF
```

The build under test must carry `EXPO_PUBLIC_COMICAL_DEMO_MODE=1` (deterministic mock data, so
consecutive captures show the same series) **and** `EXPO_PUBLIC_COMICAL_CAPTURE_MODE=1`, which
suppresses the demo-preview pill that would otherwise sit in every frame. `capture-demo.yml`
passes both; locally, set them when you build.

### Keeping the capture smooth

Frames the device never rendered are baked into the recording, and no amount of post-processing
puts them back. Three things keep them from happening, and they're worth understanding before
changing any of them:

- **`warmup.yaml` runs first and isn't recorded.** It walks the identical route so the bundle,
  fonts, and every cover image are already in cache. A cold first pass drops frames in exactly the
  transitions the capture exists to show.
- **The pauses in `demo.yaml` are `evalScript` spins, which run on the host, not the device.** The
  device sits idle holding a still frame while the recorder rolls. A pause implemented on-device
  would compete with the animation being filmed.
- **The GIF is 15fps.** The device has to sustain 15–20fps through the animations, not 60. That's
  what makes this viable on a runner at all.

The head and tail of the clip are found rather than configured. Maestro's CLI start-up sits
between the recorder opening and the flow's first command and varies run to run, so a fixed trim
would leave a different amount of dead air in every recapture. `record-demo.sh` scans the take for
scene changes and clips from just before the first movement to just after the last — which is also
why `demo.yaml` opens on the zoom instead of a tap on the already-selected Browse tab: an opening
beat that doesn't move is one the scan can't see. `launch.yaml` runs before the recorder starts so
the app is already on Browse, and the recorded flow re-enters with `stopApp: false`.

`record-demo.sh` reports the worst in-motion gap but does **not** fail on it, and that limit is
worth knowing before trying to tighten it: on variable-framerate video a still screen and a
stalled screen are the same signal — no frames. Two runs failed on that ambiguity (an 8.3s reader
hold, then the 380ms boundary between a hold and the movement after it) before it became a
warning. It also matters less than it looks, because the encode re-times every surviving frame to
a constant rate: a hitch in the source can't become a hitch in the GIF, only fewer frames
describing the same motion.

The encode strips dead air (`mpdecimate`) and re-times what's left, which is what keeps a slow CI
take watchable — commands cost 2-5s each on that simulator, and without it a 28-second movement
window encodes to 28 seconds of mostly-frozen GIF. Size is frame count x area x palette: `WIDTH`
and `MAX_COLORS` are the knobs that move it (240px/128 colors measured 3.9MB, 220/96 measured
3.0MB). `FPS` is **not** one of them — `setpts=N/FPS/TB` re-times every surviving frame, so
lowering it stretches playback rather than dropping anything.

### Why the workflow is iOS-only

The Android emulator on a GitHub runner renders through SwiftShader — software GL, because ubuntu
runners have KVM but no GPU. A Reanimated zoom transition plus full-bleed image decoding under a
software rasterizer drops frames, and `adb screenrecord` captures the framebuffer, so the drops
land in the file. macOS runners are Apple Silicon with a real GPU: the simulator is Metal-backed
and `simctl io recordVideo` encodes in hardware. `record-demo.sh` still takes `android` for a
local run against real hardware, where the question doesn't arise.
