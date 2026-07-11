/**
 * Make a Debug (dev) iOS build run standalone — no Metro packager required.
 *
 * Expo's generated AppDelegate resolves the JS bundle like this:
 *
 *     #if DEBUG
 *       return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "…")  // packager ONLY
 *     #else
 *       return Bundle.main.url(forResource: "main", withExtension: "jsbundle")        // embedded
 *     #endif
 *
 * In a Debug build the `#if DEBUG` branch asks *only* the packager. Our CI Debug
 * IPAs (the ios-dev SideStore source — see docs/PROFILING.md) DO embed a
 * `main.jsbundle` (react-native-xcode.sh bundles for a physical device even in
 * Debug), but this branch never looks at it: with no live Metro at bundle time
 * there's no `ip.txt`, so `jsBundleURL(forBundleRoot:)` returns nil and the app
 * dies with "No script URL provided … unsanitizedScriptURLString = (null)".
 *
 * This plugin appends a `?? Bundle.main.url(…)` fallback to that DEBUG branch, so:
 *   - `expo run:ios` with Metro running → jsBundleURL is non-nil → packager used
 *     (hot reload preserved);
 *   - a standalone SideStore install with no packager → jsBundleURL is nil →
 *     boots off the embedded bundle.
 * The `#else` (Release) branch is untouched, so the normal ios-latest build is
 * unaffected.
 *
 * Local Expo config plugin; referenced from app.json. Runs during prebuild
 * (ios/ is gitignored / CNG-generated).
 */
const { withAppDelegate } = require('expo/config-plugins');

const MARKER = 'COMICAL_DEV_BUNDLE_FALLBACK';
// Matches the packager-only lookup in the #if DEBUG branch, whatever bundle root
// the template uses (SDK 56: ".expo/.virtual-metro-entry").
const JS_BUNDLE_URL = /RCTBundleURLProvider\.sharedSettings\(\)\.jsBundleURL\(forBundleRoot:\s*"[^"]*"\)/;

// Pure transform (exported for unit testing). Idempotent; throws if the
// expected DEBUG jsBundleURL call is absent (catches Expo template drift).
function addBundleFallback(contents) {
  if (contents.includes(MARKER)) return contents; // idempotent

  const match = contents.match(JS_BUNDLE_URL);
  if (!match) {
    throw new Error(
      'with-ios-dev-bundle-fallback: could not find the DEBUG jsBundleURL(forBundleRoot:) call ' +
        'in AppDelegate — the Expo template changed; update JS_BUNDLE_URL.',
    );
  }

  // Prefer the packager (local dev / hot reload); fall back to the embedded
  // bundle when it's absent (standalone install with no Metro).
  const replacement =
    `${match[0]} ?? Bundle.main.url(forResource: "main", withExtension: "jsbundle") // ${MARKER}`;
  return contents.replace(JS_BUNDLE_URL, replacement);
}

module.exports = function withIosDevBundleFallback(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error(
        `with-ios-dev-bundle-fallback: expected a Swift AppDelegate, got ${cfg.modResults.language}`,
      );
    }
    cfg.modResults.contents = addBundleFallback(cfg.modResults.contents);
    return cfg;
  });
};

module.exports.addBundleFallback = addBundleFallback;
