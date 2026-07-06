# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Icons

Always use [lucide](https://lucide.dev) icons, everywhere. Import from
`lucide-react-native` (backed by `react-native-svg`) even on web — it works
cross-platform via react-native-web, so one `*.tsx` file per icon group covers
every platform with no `.web.tsx` split needed. Don't hand-roll glyphs. See
`src/components/icons/ui-icons.tsx` for the pattern.

# Bottom nav: a custom-rendered bar, not the OS-native one

`src/components/app-tabs.tsx` is a single cross-platform component (`expo-router/ui`'s
headless `Tabs`/`TabList`/`TabTrigger`, plain `Pressable`s) used on iOS, Android, and web
alike — there's no `NativeTabs`/`unstable-native-tabs` wrapper over the real
`UITabBarController`/Material 3 `NavigationBar` anymore. That was tried and reverted: iOS 26's
`tabBarMinimizeBehavior` needed react-native-screens patches to even find the content scroll
view, and even with that (plus pushing both edges imperatively, confirmed via on-device
diagnostics) the tab bar still only re-expanded once scrolled all the way back to the top, never
mid-scroll — a dead end inside UIKit's private implementation, not fixable from app code.

# Data: real API, REST-over-HTTP on every platform (for now)

Browse/Series/Reader call `useDataSource()` (`src/data/source.ts`) — never
`src/data/api.ts` or `src/data/mock.ts` directly. That's the one place real vs.
mock is decided.

- **Web talks to `@comical/host-server` over REST; native (iOS/Android) can run
  bridges on-device.** All requests go through a swappable `Transport` in
  `src/data/api.ts` (`setTransport`). The default `remoteTransport` is a plain
  `fetch` against `getApiBase()` — a Settings-configured override if the user
  set one, else `EXPO_PUBLIC_COMICAL_SERVER`, else `http://localhost:3100`. On
  native, an **embedded** transport resolves the same server-relative paths
  in-process by driving the reused `@comical/host-server` router against proxy
  bridges running in a native JS engine (JSC on iOS, QuickJS on Android) — no
  external server. This is wired in `src/data/embedded/` (a thin layer:
  `startup.ts`, `preference.ts`, `settings-store.ts`) on top of
  **`@comical/host-rn`** (the comical submodule), which owns the reusable
  machinery (proxy `BridgeProvider`, in-process transport, registry-download
  `BundleSource`, Hermes WebCrypto shim). The native module
  (`modules/comical-runtime`, wrapping comical's `ComicalBridgeContext`) is the
  engine; when it's absent (web, or before a native build) the app stays remote.
  The remote↔embedded swap is a one-tap Settings toggle; web is always remote.
  The remote server's URL is also Settings-editable (`useApiBase`/
  `setApiBaseOverride` in `data/api.ts`), but that row is hidden while the
  on-device runtime is actually active, since it wouldn't do anything then.
- **Local dev needs a running host-server.** There's no bundled dev server in
  this repo yet — run `comical-web`'s dev server (`bun run dev` in
  `comical-web`, port 3100) alongside this app's own `bun run dev`, which
  auto-presets `EXPO_PUBLIC_COMICAL_SERVER` to that server's LAN address (see
  `dev.ts` at this repo's root) so it works out of the box, including from a
  phone on the same network. It only falls back to the deployed prod API if
  you've set `EXPO_PUBLIC_COMICAL_SERVER` yourself, or overridden the server in
  Settings.
- **Mock data is reachable in exactly two cases, both dev/preview only:** the
  `__DEV__`-gated "Use mock data" toggle in Settings, and the GitHub Pages
  static preview build (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1`, set only in
  `deploy-web.yml`, since static hosting has no backend to reach — see
  `components/demo-banner.tsx`). A real production build never falls back to
  mock data on a failed request; screens show a retry state instead.
