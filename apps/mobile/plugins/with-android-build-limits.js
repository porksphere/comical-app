/**
 * Keep the Android release build inside a GitHub runner (4 cores, 16 GB).
 *
 * - Gradle's memory: the template's 2 GB heap and 512 MB metaspace ran out during R8 and packaging
 *   once the native build grew (react-native-webgpu), failing `:app:packageRelease` with Gradle's
 *   own "running out of JVM Metaspace" warning just before it.
 * - The ABIs: no 32-bit x86 build. It only serves 32-bit x86 emulators, which nothing here runs;
 *   e2e boots an x86_64 one, and phones are ARM. One ABI fewer is a quarter less native compiling,
 *   which is what took the runner's memory down with it ("the hosted runner lost communication").
 *
 * Local Expo config plugin; referenced from app.json.
 */
const { withGradleProperties } = require('expo/config-plugins');

const PROPERTIES = {
  'org.gradle.jvmargs': '-Xmx4g -XX:MaxMetaspaceSize=1g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8',
  reactNativeArchitectures: 'armeabi-v7a,arm64-v8a,x86_64',
};

module.exports = function withAndroidBuildLimits(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
      const existing = cfg.modResults.find((item) => item.type === 'property' && item.key === key);
      if (existing) existing.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
