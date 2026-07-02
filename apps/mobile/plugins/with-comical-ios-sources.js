/**
 * Copies the iOS host sources (`ComicalHostIOS`: ComicalBridgeContext etc.) + the generated
 * `harness.js` from the `comical` git submodule into the local Expo module's ios dir during
 * prebuild, so the `ComicalRuntime` podspec can reference them as LOCAL files.
 *
 * Why copy instead of pointing the podspec at the submodule: CocoaPods requires source_files to live
 * under the pod's own directory — a `../`-relative glob escaping into the submodule validates but
 * doesn't actually pull the files in (the Swift compile then can't find `ComicalBridgeContext`). The
 * Android side compiles the equivalent host sources via Gradle `sourceSets`, which has no such limit.
 *
 * Runs before `pod install`; output goes to a gitignored `ios/generated/` dir. Local Expo config
 * plugin, referenced from app.json.
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withComicalIosSources(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot; // apps/mobile
      const repoRoot = path.resolve(projectRoot, '..', '..'); // comical-app repo root
      const src = path.join(
        repoRoot,
        'external/comical/packages/host-ios/Sources/ComicalHostIOS',
      );
      const dest = path.join(projectRoot, 'modules/comical-runtime/ios/generated');

      if (!fs.existsSync(src)) {
        throw new Error(
          `with-comical-ios-sources: host-ios sources not found at ${src}. ` +
            'Ensure the comical submodule is checked out (git submodule update --init).',
        );
      }

      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.join(dest, 'Resources'), { recursive: true });

      for (const file of fs.readdirSync(src)) {
        if (file.endsWith('.swift')) {
          fs.copyFileSync(path.join(src, file), path.join(dest, file));
        }
      }

      const harness = path.join(src, 'Resources', 'harness.js');
      if (!fs.existsSync(harness)) {
        throw new Error(
          `with-comical-ios-sources: harness.js not found at ${harness}. ` +
            'Run `bun run build:native` in external/comical first.',
        );
      }
      fs.copyFileSync(harness, path.join(dest, 'Resources', 'harness.js'));

      return cfg;
    },
  ]);
};
