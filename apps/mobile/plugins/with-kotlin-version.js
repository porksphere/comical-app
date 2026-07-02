/**
 * Force the Kotlin Gradle *plugin* (compiler) version across the whole Android build.
 *
 * The on-device runtime's native deps — `quickjs-kt` 1.0.5 and the comical `host-android` sources —
 * are built with Kotlin 2.3.20, whose class metadata the Kotlin 2.1.0 compiler that Expo SDK 56 /
 * RN 0.85 ships cannot read. `expo-build-properties`'s `kotlinVersion` bumps the kotlin-stdlib
 * dependency but NOT the compiler plugin (React Native pins that), so it alone leaves the build in a
 * broken split state. This plugin forces the `kotlin-gradle-plugin` classpath version in the root
 * `build.gradle` buildscript so the compiler itself is 2.3.20 — consistent with the stdlib set by
 * expo-build-properties. A newer compiler reads older metadata, so RN's own Kotlin modules still
 * compile.
 *
 * Local Expo config plugin; referenced from app.json.
 */
const { withProjectBuildGradle } = require('expo/config-plugins');

const KOTLIN_VERSION = '2.3.20';

module.exports = function withKotlinVersion(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('with-kotlin-version: expected a groovy build.gradle');
    }
    let contents = cfg.modResults.contents;
    if (contents.includes('with-kotlin-version:force')) return cfg; // idempotent

    // Force the Kotlin gradle plugin on the buildscript classpath. Inserted right after the
    // buildscript block opens so it applies before RNGP resolves the plugin.
    const force = [
      'buildscript {',
      '    // with-kotlin-version:force — align the Kotlin compiler with quickjs-kt/host-android (2.3.20)',
      '    configurations.classpath {',
      `        resolutionStrategy { force "org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}" }`,
      '    }',
    ].join('\n');

    if (!contents.includes('buildscript {')) {
      throw new Error('with-kotlin-version: no buildscript block found in root build.gradle');
    }
    contents = contents.replace('buildscript {', force);
    cfg.modResults.contents = contents;
    return cfg;
  });
};
