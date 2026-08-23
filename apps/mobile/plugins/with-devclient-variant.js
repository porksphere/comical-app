/**
 * Mark non-release builds in the app's display name, without changing their identity.
 *
 * Two variants, both activated only by an env var set at prebuild time:
 *
 *   COMICAL_DEVCLIENT=1  the development-client shell (build-ios-devclient.yml) — a Debug build
 *                        with `expo-dev-client` that loads JS from a Metro server. Named " (dev)".
 *   COMICAL_PROFILING=1  a Release binary carrying the on-device Hermes profiler (build-ios.yml's
 *                        rolling main + per-PR builds). Named " (profiling)".
 *
 * For everything else — versioned `ios-release`, local `expo run` — this plugin is a no-op.
 *
 * WHY NEITHER CHANGES THE BUNDLE ID. Every build installs into the SAME slot as
 * `com.porksphere.comical`, so they all share one data container: a library built against a PR
 * build is still there when you switch to the dev-client, and the reverse. That is the point —
 * iterating over Metro against your real library beats iterating against an empty one.
 *
 * The dev-client used to carry a `.dev` suffix so it could sit beside the release app. Coexistence
 * and shared data are mutually exclusive on iOS (the container is keyed by bundle id), and shared
 * data is worth more here. The cost: installing the dev-client REPLACES whatever Comical is on the
 * phone, and reinstalling a release build replaces it back. Both re-signs come from the same
 * SideStore free-account app slot, so this also stops the dev shell consuming a second one.
 *
 * Local Expo config plugin; referenced from app.json. A config plugin is just a
 * `(config) => config` transform, so this mutates the base config directly.
 */

// Append " (label)" to the display name. Identity — bundle id / package — is deliberately untouched
// so the variant shares its data container with every other build.
function applyLabel(config, label) {
  return { ...config, name: config.name ? `${config.name} (${label})` : config.name };
}

// Pure transforms (exported for unit testing).
//
// The dev-client also opts out of App Transport Security. It loads its JS over plain HTTP from a
// Metro server, and iOS blocks cleartext unless told otherwise. Expo's default grants
// NSAllowsLocalNetworking, which covers RFC1918 (10/8, 172.16/12, 192.168/16) and .local — enough
// for a Metro box on your LAN, and NOT enough for one reached over Tailscale, whose addresses live
// in 100.64.0.0/10 (RFC6598 shared address space). iOS then refuses the load before opening a
// socket: the launcher reports "failed to connect" and a packet capture on the server sees nothing
// at all, because nothing was ever sent.
//
// Scoped to COMICAL_DEVCLIENT so no release, PR or profiling build ever ships arbitrary loads —
// this is a Debug shell that only ever talks to a dev server you point it at.
function applyDevClientVariant(config, enabled) {
  if (!enabled) return config;
  const labeled = applyLabel(config, 'dev');
  return {
    ...labeled,
    ios: {
      ...labeled.ios,
      infoPlist: {
        ...labeled.ios?.infoPlist,
        NSAppTransportSecurity: {
          ...labeled.ios?.infoPlist?.NSAppTransportSecurity,
          NSAllowsArbitraryLoads: true,
          NSAllowsLocalNetworking: true,
        },
      },
    },
  };
}

function applyProfilingVariant(config, enabled) {
  return enabled ? applyLabel(config, 'profiling') : config;
}

module.exports = function withDevClientVariant(config) {
  // Dev-client wins if both are somehow set; otherwise apply the profiling variant.
  if (process.env.COMICAL_DEVCLIENT === '1') return applyDevClientVariant(config, true);
  return applyProfilingVariant(config, process.env.COMICAL_PROFILING === '1');
};

module.exports.applyDevClientVariant = applyDevClientVariant;
module.exports.applyProfilingVariant = applyProfilingVariant;
