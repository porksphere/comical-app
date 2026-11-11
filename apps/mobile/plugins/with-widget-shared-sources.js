/**
 * Copies the widget extension's `SharedContainer.swift` into the `home-widgets` module during
 * prebuild, so the app and its widgets compile ONE answer to where their shared folder is. They
 * find it by the same search (the App Group a sideload signer renamed), and two copies kept by
 * hand would be free to disagree, which shows as widgets that stay empty.
 *
 * A copy, not a path out of the pod: CocoaPods only compiles sources under the pod's own
 * directory (see `with-comical-ios-sources.js`). Output goes to the gitignored `ios/generated/`.
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withWidgetSharedSources(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const dest = path.join(projectRoot, 'modules/home-widgets/ios/generated');
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(
        path.join(projectRoot, 'targets/widgets/SharedContainer.swift'),
        path.join(dest, 'SharedContainer.swift'),
      );
      return cfg;
    },
  ]);
};
