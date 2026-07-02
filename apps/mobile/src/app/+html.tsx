import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Web-only: configures the root HTML for every page of the static web export.
 * This component runs only in Node during static rendering — it has no access to
 * the DOM or browser APIs.
 *
 * The app is dark-only (see `FORCED_COLOR_SCHEME` in `@/hooks/use-theme`), so we
 * declare a dark `color-scheme` and paint the page background dark up front. This
 * stops the browser from flashing a white page before React mounts.
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
        <meta name="color-scheme" content="dark" />

        {/*
          Disable body scrolling on web so position: fixed React Native
          ScrollViews work. Remove this for a global, document-level scroll.
        */}
        <ScrollViewStyleReset />

        {/* Dark page background before hydration — matches Colors.dark.background. */}
        <style dangerouslySetInnerHTML={{ __html: rootStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const rootStyle = `
body { background-color: #000000; }
`;
