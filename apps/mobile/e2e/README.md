# comical-app end-to-end tests (Maestro)

One flow, written once, drives web, Android, and iOS. Runs in CI on every PR (see
`.github/workflows/e2e.yml`) and locally the same way.

## Why Maestro, and why no per-platform reimplementation

Maestro flows are plain YAML, select elements by `id:` (matched to `accessibilityIdentifier` on
iOS, `resource-id` on Android, and `data-testid` on web via react-native-web), and — as of the Beta
web support Maestro shipped in 2025/2026 — run against Android, iOS, *and* a managed Chromium
browser from the exact same flow format. That `id:` selector is precisely this app's existing
`testID` convention (`src/lib/test-id.ts`), so a single flow body genuinely works unmodified on all
three platforms. No custom adapter/interpreter exists in this repo, and none is needed — Maestro
itself is the adapter.

## Layout

```
e2e/
  flows/     # the actual journeys — platform-agnostic, no appId/url header, never run directly
  android/   # thin entrypoints: appId + `runFlow: ../flows/<name>.yaml`
  ios/       # same, same appId (both platforms share com.porksphere.comical)
  web/       # same, but `url: http://localhost:4000` instead of appId
  config/    # one Maestro workspace config per platform (execution order, flow glob)
  scripts/
    run-device.sh   # local runner: reconnects a dev-client build to Metro, then runs a flow
```

**Write a flow once, in `flows/`.** Add a two-line entrypoint per platform you want it to run on
(`android/`, `ios/`, `web/`) — copy an existing entrypoint, it's always just `appId`/`url` +
`runFlow`. A flow doesn't need all three; e.g. `swipe-dismiss.yaml` currently ships only
`android/`+`ios/` entrypoints (web mouse-drag gesture parity with a touch swipe hasn't been
verified yet — add `web/swipe-dismiss.yaml` once it has).

## Data: demo/mock mode only

Every CI build in this suite is built with `EXPO_PUBLIC_COMICAL_DEMO_MODE=1` — fully client-side
mock data (`src/data/mock.ts`), no host-server or bridge involved. This is deliberate: it keeps
flows deterministic and fast, and means PRs from external contributors never trigger live
scraping-adjacent bridge traffic. A flow should never depend on data that only a real backend
would produce.

## Platform divergence

Most screens render identical testIDs on every platform (the custom tab bar in `app-tabs.tsx`
does, for instance), so most flows need no platform branching at all. When a screen genuinely
differs (e.g. a desktop-only sidebar column), branch *inside* the shared flow body with Maestro's
`when: { platform: ... }` conditional steps — check current syntax at
https://docs.maestro.dev before relying on it, Maestro's flow schema evolves. Don't fork the flow
file per platform for this; that's exactly the duplication this suite exists to avoid.

## Running locally

**Android / iOS (dev-client, Metro-connected):**
```
bun run dev:device                                   # start Metro, from apps/mobile
bash e2e/scripts/run-device.sh android smoke.yaml     # one flow
bash e2e/scripts/run-device.sh android                # every android/ flow, in order
bash e2e/scripts/run-device.sh ios browse-to-reader.yaml
```
Requires the dev-client build already installed (`expo run:android` / the `ios-devclient`
SideStore channel — see repo root docs) and Maestro installed (below).

**Web:**
```
PORT=4000 EXPO_PUBLIC_COMICAL_DEMO_MODE=1 bun run dev      # from apps/mobile
maestro test e2e/web/smoke.yaml                             # in a second terminal
```

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
   finished flow into `flows/` here plus its per-platform entrypoints once it's reliable. Don't
   skip straight to writing in `flows/` for anything you haven't run at least once.
3. Every new user-facing screen or flow should get a flow here — see the root `AGENTS.md` and the
   PR template checklist. `apps/mobile/scripts/check-flow-coverage.mjs` (run in CI, advisory-only)
   flags new tab/screen-title testIDs that no committed flow references yet.

## Selector conventions (from `src/lib/test-id.ts`)

Dot-namespaced `area.element[.qualifier]`; list items suffix a stable domain id:
`tab.<route>`, `browse.search-icon`, `series-card.<seriesId>`, `series.cover`,
`series.chapter.<key>`, `reader.toolbar.back`, `settings.category.general`. Maestro treats `id:`
as a regex, so `series-card\\..*` matches the first card. Grep `src/` for `testID`/`testId(` to
find more.
