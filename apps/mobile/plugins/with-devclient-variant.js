/**
 * Give the **development-client** build a distinct identity so it coexists with
 * the normal Comical on a device instead of replacing it.
 *
 * Activated only when `COMICAL_DEVCLIENT=1` is set at prebuild time — which the
 * dedicated `build-ios-devclient.yml` CI job sets, and nothing else does. So for
 * every normal build (main's ios-latest Release, per-PR Release, versioned
 * releases, local `expo run`) this plugin is a **no-op** and the app keeps its
 * production id. When active it suffixes the iOS bundle id / Android package with
 * `.dev` and appends " (dev)" to the display name.
 *
 * Why a distinct id: the dev-client build is a debug shell that loads JS from a
 * Metro server over your LAN (the Windows iterative-dev loop — see
 * docs/PROFILING.md). Keeping it on `com.porksphere.comical.dev` lets it sit
 * next to the real app on the same phone. (A free Apple ID signs up to a handful
 * of distinct app ids, so one extra is fine.)
 *
 * Local Expo config plugin; referenced from app.json. A config plugin is just a
 * `(config) => config` transform, so this mutates the base config directly —
 * no native-file mods needed.
 */
const DEV_SUFFIX = '.dev';

// Pure transform (exported for unit testing). Idempotent-ish: only mutates when
// the env flag is set, and the CI job runs a fresh prebuild each time.
function applyDevClientVariant(config, enabled) {
  if (!enabled) return config;

  const name = config.name ? `${config.name} (dev)` : config.name;
  const iosId = config.ios?.bundleIdentifier;
  const androidPkg = config.android?.package;

  return {
    ...config,
    name,
    ios: iosId ? { ...config.ios, bundleIdentifier: `${iosId}${DEV_SUFFIX}` } : config.ios,
    android: androidPkg
      ? { ...config.android, package: `${androidPkg}${DEV_SUFFIX}` }
      : config.android,
  };
}

module.exports = function withDevClientVariant(config) {
  return applyDevClientVariant(config, process.env.COMICAL_DEVCLIENT === '1');
};

module.exports.applyDevClientVariant = applyDevClientVariant;
