import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Web-only: configures the root HTML for every page of the static web export.
 * This component runs only in Node during static rendering — it has no access to
 * the DOM or browser APIs.
 *
 * The app supports light/dark/system (see `useThemePreference` in
 * `@/hooks/use-theme`), and the static export can't read the persisted
 * preference before React mounts. So we declare `color-scheme: light dark` and
 * paint the pre-hydration page background from the OS preference via a
 * `prefers-color-scheme` media query — matching the `'system'` default and
 * stopping a white flash before React takes over. A user who has pinned the
 * opposite fixed theme may still see a brief flash on first paint; that's the
 * one case the media query can't cover without the stored value.
 *
 * We intentionally do NOT disable browser zoom globally here. The reader owns its
 * own pinch-zoom and suppresses the browser's native pinch *only on the reader
 * surface* (touch-action: none + scoped listeners in the reader web components),
 * so the rest of the app keeps normal scrolling and accessibility zoom. The
 * viewport's `viewport-fit=cover` just makes the app full-bleed under the
 * notch / home indicator.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />

        {/*
          Disable body scrolling on web so position: fixed React Native
          ScrollViews work. Remove this for a global, document-level scroll.
        */}
        <ScrollViewStyleReset />

        {/* Page background before hydration — light by default, dark when the OS
            prefers dark. Matches Colors.light/​dark.background. */}
        <style dangerouslySetInnerHTML={{ __html: rootStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const rootStyle = `
:root { color-scheme: light dark; }
body { background-color: #ffffff; }
@media (prefers-color-scheme: dark) {
  /* Matches Colors.dark.background — this is what shows through an overscroll
     bounce and before the app has painted, so a mismatch reads as a flash. */
  body { background-color: #000000; }
}
`;
