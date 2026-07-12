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
const PROFILING_SUFFIX = '.profiling';

// Suffix the bundle id / package and append " (label)" to the display name, so a variant coexists
// with the production app on the same device instead of replacing it.
function applyVariant(config, suffix, label) {
  const name = config.name ? `${config.name} (${label})` : config.name;
  const iosId = config.ios?.bundleIdentifier;
  const androidPkg = config.android?.package;

  return {
    ...config,
    name,
    ios: iosId ? { ...config.ios, bundleIdentifier: `${iosId}${suffix}` } : config.ios,
    android: androidPkg ? { ...config.android, package: `${androidPkg}${suffix}` } : config.android,
  };
}

// Pure transforms (exported for unit testing). Idempotent-ish: only mutate when the flag is set,
// and the CI job runs a fresh prebuild each time.
function applyDevClientVariant(config, enabled) {
  return enabled ? applyVariant(config, DEV_SUFFIX, 'dev') : config;
}

// The profiling-release variant: a normal Release binary that carries the on-device profiler, given
// `com.porksphere.comical.profiling` + " (profiling)" so it sits next to the real app for a
// before/after release profile. Activated by COMICAL_PROFILING=1 (build-ios-profiling.yml only).
function applyProfilingVariant(config, enabled) {
  return enabled ? applyVariant(config, PROFILING_SUFFIX, 'profiling') : config;
}

module.exports = function withDevClientVariant(config) {
  // Dev-client wins if both are somehow set; otherwise apply the profiling variant.
  if (process.env.COMICAL_DEVCLIENT === '1') return applyDevClientVariant(config, true);
  return applyProfilingVariant(config, process.env.COMICAL_PROFILING === '1');
};

module.exports.applyDevClientVariant = applyDevClientVariant;
module.exports.applyProfilingVariant = applyProfilingVariant;
