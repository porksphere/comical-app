import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

// Root HTML shell for the static web export (web.output = "static"). This is the
// one place to control the document <head> for every route.
//
// We intentionally do NOT disable browser zoom globally here. The reader owns
// its own pinch-zoom and suppresses the browser's native pinch *only on the
// reader surface* (touch-action: none + scoped listeners in paged-reader.web.tsx),
// so the rest of the app keeps normal scrolling and accessibility zoom. The
// viewport just makes the app full-bleed under the notch/home indicator.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Disable body scrolling on web so position: fixed React Native
            ScrollViews work, and keep the dark background to avoid a flash. */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: backgroundReset }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const backgroundReset = `
body { background-color: #fff; }
@media (prefers-color-scheme: dark) {
  body { background-color: #000; }
}`;
