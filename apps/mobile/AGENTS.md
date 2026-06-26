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
