# comical-app end-to-end tests (Maestro)

The same journey, written once for mobile and once for web, drives web, Android, and iOS. Runs
in CI on every PR (see `.github/workflows/e2e.yml`) and locally the same way.

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
