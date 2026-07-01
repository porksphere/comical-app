# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Icons

On web, always use [lucide](https://lucide.dev) icons via `lucide-react` (a
web-only dependency). Don't hand-roll glyphs for the web build.

`lucide-react-native` is not installed, so native has no lucide. Use the
`.web.tsx` platform split: put the lucide version in `*.web.tsx` and a React
Native fallback (or platform-appropriate icon) in the matching `*.tsx`, keeping
their exports in sync. See `src/components/filters/filter-icons.{web.,}tsx` for
the pattern.

# Data: real API, REST-over-HTTP on every platform (for now)

Browse/Series/Reader call `useDataSource()` (`src/data/source.ts`) — never
`src/data/api.ts` or `src/data/mock.ts` directly. That's the one place real vs.
mock is decided.

- **Every platform (iOS, Android, web) talks to `@comical/host-server` over
  REST.** The long-term goal for native is to bundle the Comical core
  (`@comical/core`/`@comical/runtime`) and run bridges on-device instead of
  over HTTP, but that needs a Hermes/QuickJS-compatible `BundleEvaluator` in
  `comical/packages/core/src/evaluator.ts`, which doesn't exist yet (only a
  Node `vm` evaluator and a browser `new Function()` evaluator do). Until
  that lands upstream, native uses the same REST client as web.
- **Local dev needs a running host-server.** There's no bundled dev server in
  this repo yet — run `comical-web`'s dev server (`bun run dev` in
  `comical-web`, port 3100) alongside this app's own `bun run dev` and point
  `EXPO_PUBLIC_COMICAL_SERVER` at it (defaults to the deployed prod API
  otherwise).
- **Mock data is reachable in exactly two cases, both dev/preview only:** the
  `__DEV__`-gated "Use mock data" toggle in Settings, and the GitHub Pages
  static preview build (`EXPO_PUBLIC_COMICAL_DEMO_MODE=1`, set only in
  `deploy-web.yml`, since static hosting has no backend to reach — see
  `components/demo-banner.tsx`). A real production build never falls back to
  mock data on a failed request; screens show a retry state instead.
