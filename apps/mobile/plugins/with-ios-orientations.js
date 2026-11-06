/**
 * Let the app rotate on **iOS** while Android stays **portrait-locked**.
 *
 * Expo's top-level `orientation` key is global: `"portrait"` correctly locks the
 * Android phone, but it would also lock every iPhone and iPad. iOS supports
 * device-specific Info.plist keys that override the base
 * `UISupportedInterfaceOrientations`: `~ipad` on iPad and `~iphone` on iPhone. So
 * we keep `orientation: "portrait"` in app.json and widen both families here.
 *
 * iPad gets all four orientations. This pairs with `ios.supportsTablet: true` in
 * app.json (which makes prebuild emit `UIDeviceFamily = [1, 2]` for native iPad
 * rendering); without free rotation an iPad app opts out of some multitasking, so
 * allowing all orientations also keeps Split View / Slide Over working (we
 * deliberately do NOT set `requireFullScreen`).
 *
 * iPhone gets both landscapes, not upside-down. From iOS 27 a lock is only a
 * preference on the wide iPhones, which may put the app in landscape regardless,
 * so landscape has to be a layout the app actually has rather than one it is
 * forced into untested.
 *
 * Local Expo config plugin, referenced from app.json. Unlike the base-config
 * transforms in `with-devclient-variant.js`, this touches a native Info.plist key,
 * so it uses `withInfoPlist`. Prebuild regenerates the native project each build,
 * so there's nothing to edit by hand.
 */
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withIosOrientations(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults['UISupportedInterfaceOrientations~ipad'] = [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ];
    cfg.modResults['UISupportedInterfaceOrientations~iphone'] = [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ];
    return cfg;
  });
};
