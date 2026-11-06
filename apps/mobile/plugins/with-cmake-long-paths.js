/**
 * Build the app's native code with a CMake whose ninja accepts long paths on Windows.
 *
 * AGP defaults to CMake 3.22.1, whose bundled ninja 1.10 refuses any object path over 260
 * characters regardless of the system long-path setting. The codegen object files for
 * react-native-gesture-handler 3 (and others) mirror the absolute source path under the `.cxx`
 * build dir, which puts them well past that limit on any realistic checkout path, so a local
 * Windows debug build dies in `buildCMakeDebug`. CMake 3.31.6 ships ninja 1.12, which honours
 * `LongPathsEnabled`. Gated on the host OS so macOS/Linux CI keeps the default toolchain.
 *
 * Local Expo config plugin; referenced from app.json.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const CMAKE_VERSION = '3.31.6';
const MARKER = 'with-cmake-long-paths';

module.exports = function withCmakeLongPaths(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(`${MARKER}: expected a groovy app/build.gradle`);
    }
    const contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) return cfg;

    const anchor = /^android \{\n/m;
    if (!anchor.test(contents)) {
      throw new Error(`${MARKER}: no android block found in app/build.gradle`);
    }
    const block = [
      'android {',
      `    // ${MARKER} — ninja 1.10 (CMake 3.22) rejects >260-char object paths on Windows`,
      "    if (System.getProperty('os.name').toLowerCase().contains('windows')) {",
      `        externalNativeBuild { cmake { version "${CMAKE_VERSION}" } }`,
      '    }',
      '',
    ].join('\n');
    cfg.modResults.contents = contents.replace(anchor, block);
    return cfg;
  });
};
