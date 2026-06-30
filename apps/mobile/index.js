import { Alert } from 'react-native';

// TEMPORARY launch diagnostics. The app is crashing immediately on iOS with no
// on-screen indication of why: an uncaught JS exception is reaching React
// Native's default fatal handler, which aborts the process in release builds.
// Crash logs (.ips) only show that this happened, never the JS error message
// itself, and the root error boundary in src/app/_layout.tsx only catches
// errors during React's render/commit phase — not event handlers, the async
// tail of an effect, or unhandled promise rejections, any of which could be
// the actual source here.
//
// Installing this handler as the very first thing executed (ahead of
// expo-router and all app code, so it's in place no matter how early the
// throw happens) intercepts every uncaught JS exception and shows it in a
// native alert instead of silently dying, so the message can finally be read
// off the device. Remove once the real bug is found and fixed.
if (typeof global !== 'undefined' && global.ErrorUtils) {
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error('[launch-diagnostic]', isFatal ? 'FATAL' : 'soft', error);
    if (isFatal) {
      const message = `${error?.message ?? String(error)}\n\n${error?.stack ?? ''}`;
      // Showing a UIAlertController this early in the launch sequence makes RN
      // create a brand-new UIWindow tied to the app's scene to host it — and
      // doing that immediately races iOS's scene-connection lifecycle (this
      // crashed inside UIKit's own window/scene machinery on the previous
      // diagnostic build, masking the original error entirely). Give the scene
      // a few seconds to settle before showing it.
      setTimeout(() => {
        try {
          Alert.alert('Fatal JS error (caught for diagnostics)', message);
        } catch {
          // Still not safe to show — nothing more we can do here.
        }
      }, 3000);
    }
  });
}

require('expo-router/entry');
