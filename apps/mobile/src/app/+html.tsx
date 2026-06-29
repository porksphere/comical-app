import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

// Root HTML shell for the static web export (web.output = "static"). This is the
// one place to control the document <head> for every route.
//
// The viewport pins the scale so the browser's own pinch-zoom is disabled: on
// iOS WebKit (Safari AND Chrome, which is WebKit underneath) a two-finger pinch
// would otherwise zoom the whole page on top of the reader's in-app zoom — two
// zooms fighting, which read as jitter. `maximum-scale=1` / `user-scalable=no`
// is honoured there, so only our gesture-driven zoom remains. The app is
// full-bleed and app-like, so disabling browser zoom site-wide is intended.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        {/* Disable body scrolling on web so position: fixed React Native
            ScrollViews work, and keep the dark background to avoid a flash. */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: backgroundReset }} />
        {/* iOS WebKit ignores the viewport scale lock above, so suppress the
            browser's own pinch / gesture zoom directly. Runs inline (before
            React mounts) and globally so it's always active. The reader's
            in-app zoom is driven by pointer events and is unaffected; only the
            browser's native zoom is cancelled. Single-finger touches (scroll,
            swipe) are never prevented. */}
        <script dangerouslySetInnerHTML={{ __html: disableBrowserZoom }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const backgroundReset = `
body { background-color: #fff; }
@media (prefers-color-scheme: dark) {
  body { background-color: #000; }
}
/* Allow one-finger panning/scrolling but forbid the browser's pinch- and
   double-tap-zoom everywhere. iOS WebKit (Safari + Chrome) honours touch-action
   for this even though it ignores the viewport scale lock. The reader's own
   pinch zoom runs off pointer events and is unaffected. */
* { touch-action: pan-x pan-y; }`;

const disableBrowserZoom = `
(function () {
  if (typeof document === 'undefined') return;
  var stop = function (e) { e.preventDefault(); };
  // Cancel a pinch the moment a second finger lands, before it's recognised.
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  // Safari/WebKit pinch gesture events.
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('gestureend', stop, { passive: false });
  // iOS sets a non-standard \`scale\` on touch events during a pinch; only then
  // do we cancel (so one-finger scrolling/swiping is left alone).
  document.addEventListener('touchmove', function (e) {
    if ((typeof e.scale === 'number' && e.scale !== 1) || e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });
})();`;
