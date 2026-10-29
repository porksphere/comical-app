/**
 * Let the app rotate freely on **iPad** while keeping **iPhone portrait-locked**.
 *
 * Expo's top-level `orientation` key is global: `"portrait"` correctly locks the
 * iPhone, but it would also lock the iPad. iOS supports a device-specific
 * `UISupportedInterfaceOrientations~ipad` Info.plist key that overrides the base
 * `UISupportedInterfaceOrientations` on iPad only — so we keep `orientation:
 * "portrait"` in app.json (iPhone stays portrait) and set all four orientations
 * here for iPad.
 *
 * This pairs with `ios.supportsTablet: true` in app.json (which makes prebuild emit
 * `UIDeviceFamily = [1, 2]` for native iPad rendering); without free rotation an
 * iPad app opts out of some multitasking, so allowing all orientations also keeps
 * Split View / Slide Over working (we deliberately do NOT set `requireFullScreen`).
 *
 * Local Expo config plugin, referenced from app.json. Unlike the base-config
 * transforms in `with-devclient-variant.js`, this touches a native Info.plist key,
 * so it uses `withInfoPlist`. Prebuild regenerates the native project each build,
 * so there's nothing to edit by hand.
 */
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withIpadOrientations(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults['UISupportedInterfaceOrientations~ipad'] = [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ];
    return cfg;
  });
};
