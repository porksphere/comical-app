import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Web-only: configures the root HTML for every page of the static web export.
 * This component runs only in Node during static rendering — it has no access to
 * the DOM or browser APIs.
 *
 * The app is dark-only (see `FORCED_COLOR_SCHEME` in `@/hooks/use-theme`), so we
 * declare a dark `color-scheme` and paint the page background dark up front. This
 * stops the browser from flashing a white page (Expo's default root HTML sets a
 * light body background on non-dark OSes) before React mounts. If the app ever
 * goes back to following the OS scheme, restore the responsive background below.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="color-scheme" content="dark" />

        {/*
          Disable body scrolling on web so ScrollView components work as expected.
          Remove this if you want to use a global, document-level scroll instead.
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
