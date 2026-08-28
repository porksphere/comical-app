# Profiling (iOS)

How to profile the app on iOS to find what's actually causing a slowdown — which layer
(JavaScript vs. native), which component, which function. For the build/release pipeline see
[DEVELOPMENT.md](DEVELOPMENT.md); for the architecture see [ARCHITECTURE.md](ARCHITECTURE.md).

## First, know which engine you're profiling

The app's **UI/React JavaScript runs on Hermes** (Expo SDK 56 / RN 0.85 default — there's no
`jsEngine` override in `app.json`). The "JavaScriptCore on iOS" line elsewhere in the docs refers
to the **embedded bridge runtime** — a *separate* JS context inside the `comical-runtime` native
module where on-device bridges execute — **not** the React/UI JS. So:

- Slow scrolling, slow screen transitions, re-render churn → **Hermes** (your React code). Profile
  with React Native DevTools (below).
- Slow *data fetching on native* (a bridge parsing a page) → the embedded JSC context. That's a
  different beast; start by timing the request in `src/data/` before reaching for a native profiler.

## You need a Mac, Xcode, and a real iPhone

- **Xcode** from the App Store, then `xcode-select --install` and `sudo xcodebuild -license accept`.
- **A physical iPhone**, not the Simulator. The Simulator runs on your Mac's CPU (an M-series chip
  is far faster than any iPhone) and has no real GPU or thermal throttling — it will lie to you
  about frame drops. Every number below assumes a real device.
- `brew install watchman cocoapods` (bun you already have).

## Get a dev build onto the device

The app can't run in Expo Go (custom native module + config plugins), so profiling uses a local
dev build wired to Metro:

```bash
bun run setup            # first time / fresh clone (submodule + deps + native harness)
cd apps/mobile
bun run ios --device     # = expo run:ios --device; pick your iPhone when prompted
```

First build is a full native compile (slow); Xcode may ask you to pick a free-Apple-ID signing
team — the same identity you use for SideStore. It installs the app, launches it, and starts Metro.
**Leave the Metro terminal open — it's your control panel** (press keys in it to open tools).

For a backend, run `comical-web`'s dev server (`bun run dev`, :3100) on the Mac — the app's `dev.ts`
auto-points `EXPO_PUBLIC_COMICAL_SERVER` at your LAN IP. Or flip **Settings → Use mock data** to
isolate pure rendering cost from network latency for a first pass.

## The three profilers

### 1. React Native DevTools → Performance panel (JS thread / Hermes) — start here

Your main "what JS is eating the frame" tool.

1. In the Metro terminal press **`j`** (opens React Native DevTools, a Chrome-DevTools window). Or
   shake the phone → **Open DevTools**.
2. **Performance** tab → record ● → do the slow interaction on the phone (scroll Library/Browse,
   open a Series, page the Reader) → stop.
3. Read the flame chart: wide frames = long JS tasks. Export the `.cpuprofile` to keep it.

### 2. React DevTools **Profiler** (⚛️ tab, same window) — re-render analysis

The tool that answers "is a component re-rendering when it shouldn't?" — directly relevant to the
LegendList work and the React Compiler.

1. Same DevTools window → **Profiler** (⚛️) tab → settings gear → enable **"Record why each
   component rendered."**
2. Record → interact → stop. The commit flamegraph shows which components re-rendered, how often,
   and *why* (which prop/state/hook changed).
3. Because `reactCompiler: true` is on, most manual-memo candidates are already stable (measured —
   see `comical-app-react-compiler-memo` note). So focus on **mount cost** and **list-cell churn**
   (LegendList recycling), not on hand-adding `React.memo`.

### 3. Xcode **Instruments** — native CPU / GPU / hitches / memory

For everything below the JS layer: image decode (`expo-image`), scroll hitches, Reanimated
worklets, memory growth.

1. Xcode → **Open Developer Tool → Instruments**.
2. Template: **Time Profiler** (CPU hotspots), **Animation Hitches** / **Core Animation** (scroll
   jank), or **Allocations/Leaks** (memory).
3. Target your iPhone, select the **Comical** process, record → interact → stop. Filter the call
   tree to the Comical process and drill into the heaviest stacks.

## Dev vs. release — the accuracy caveat

A dev build carries React dev-mode overhead (extra checks, no minification, dev warnings), so its
*absolute* milliseconds are inflated. Use it to find **relative** hotspots ("component X
dominates"), then confirm real magnitude with a release build:

```bash
bun run ios --device --configuration Release
```

Hermes sampling still works in release, and Instruments' Time Profiler on a release build gives
production-representative numbers. React Native DevTools' JS debugger won't attach to release, so
the pattern is: **find hotspots in dev (tools 1–2), confirm magnitude in release (tool 3).**

## Fast triage before you profile

Shake → **Show Perf Monitor** overlays live JS-thread and UI-thread FPS. If UI FPS drops while JS
FPS stays high, the bottleneck is native/render (→ Instruments); if JS FPS tanks, it's your
JavaScript (→ React Native DevTools). That one glance tells you which profiler to reach for.

## Iterative dev & profiling from Windows (the dev-client loop)

You don't need a Mac in the loop. An Expo app splits in two: the **native binary** (built on macOS
— but CI's `macos-26` runner does that, not you) and the **JS/TS bundle** (Metro, which runs fine on
Windows). The trick is a [**development-client**](https://docs.expo.dev/develop/development-builds/introduction/)
build — a debug shell with `expo-dev-client` — that loads its JS from a Metro server over your LAN.
Build the shell once; iterate the JS forever from the PC.

> Note what does **not** work: a *standalone offline* debug build. Expo deliberately sets
> `SKIP_BUNDLING=1` for debug, so a CI debug build embeds no JS and crashes with *"No script URL
> provided."* The dev-client build sidesteps this by loading JS from Metro (online), not from an
> embedded bundle — and its launcher shows instead of crashing when no server is set. That's the
> supported path; don't chase the offline one.

**One-time (CI does the macOS part):**
1. `build-ios-devclient.yml` builds a Debug + `expo-dev-client` shell carrying the shared
   `com.porksphere.comical` bundle id and publishes it to the rolling `ios-devclient` SideStore
   source. It runs **twice weekly on `main`**, so there is normally a recent one waiting; run the
   workflow by hand (`workflow_dispatch`) when you need a native change from today.
2. Add that source in SideStore/AltStore and install **Comical (dev)**. It carries the production
   bundle id, so it *replaces* whatever Comical is installed and inherits its data — which is the
   point: you iterate against your real library. Reinstall from `ios-main`/`ios-release` to switch
   back. Rebuild only when *native* code changes (a native module, a config plugin, an SDK bump).

**Every day (all on Windows):**
1. `bun run dev:device` on the PC → Metro on `http://<lan-ip>:8081`, prints a QR.
2. On the phone (same Wi-Fi): open **Comical (dev)** → scan the QR / enter the URL from its launcher.
3. Edit `.tsx` → **Fast Refresh** on device in ~1s. **Shake → dev menu.** No rebuild.

**Profiling over this loop:** React Native DevTools attaches to the *Metro* server, so tools **1**
and **2** above (Hermes sampling profiler, React Profiler) work from the PC against the app on your
phone — press `j` in the `bun run dev:device` terminal. Only **Xcode Instruments** (tool 3, native
CPU/GPU/memory) still needs macOS. So Windows covers JS-thread profiling; the Mac is only for native.

For a fully local setup on a Mac instead, `cd apps/mobile && bun run ios --device` builds and runs the
same dev-client shell directly. To iterate against a PR's NATIVE code, dispatch this workflow on that
branch. See [DEVELOPMENT.md](DEVELOPMENT.md) for the build pipeline; the per-PR `ios-pr` builds
remain plain **Release** (installable for UI checks, no dev menu).
