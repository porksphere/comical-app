/**
 * Let every build reach the servers a user points it at, over plain HTTP and behind a CA the user
 * installed themselves.
 *
 * Bridges talk to self-hosted backends (Komga, Kavita, OPDS, a host-server) whose address the user
 * types in at run time, and those are routinely `http://` on the LAN or over a VPN or overlay
 * network such as Tailscale (100.64.0.0/10). Neither platform can be given a per-host exception for
 * an address nobody knows at build time, so cleartext is allowed outright, as the self-hosted
 * clients this app sits beside do (Jellyfin, Immich, Audiobookshelf, Mihon, Aidoku). Warning a user
 * whose credentials would cross the internet unencrypted is the bridge's job, in its settings form.
 *
 * Local Expo config plugin; referenced from app.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

// iOS. Replaced wholesale, NOT merged, and NSAllowsLocalNetworking (which Expo's template sets) is
// deliberately absent: on iOS 10+ NSAllowsArbitraryLoads is IGNORED, effective NO, whenever
// NSAllowsLocalNetworking, NSAllowsArbitraryLoadsForMedia or ...InWebContent is also present. Both
// set reads as permissive and behaves exactly as restrictive as Expo's default, which reaches only
// RFC1918 and .local. Verify a change here against the BUILT binary (Payload/*.app/Info.plist in the
// IPA), not the source: the first attempt looked right in both and still blocked every connection.
function applyIosArbitraryLoads(config) {
  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      },
    },
  };
}

// Android. A network security config rather than `usesCleartextTraffic`, because only the config
// can also trust user-installed CAs, which apps targeting API 24+ otherwise ignore. That is the
// supported route for a home server behind its own CA: install the CA on the device.
const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

function applyNetworkSecurityConfigAttribute(manifest) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error('with-user-server-network: AndroidManifest.xml has no <application>');
  app.$ = { ...app.$, 'android:networkSecurityConfig': '@xml/network_security_config' };
  return manifest;
}

module.exports = function withUserServerNetwork(config) {
  config = applyIosArbitraryLoads(config);
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyNetworkSecurityConfigAttribute(cfg.modResults);
    return cfg;
  });
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'network_security_config.xml'), NETWORK_SECURITY_CONFIG);
      return cfg;
    },
  ]);
};

module.exports.applyIosArbitraryLoads = applyIosArbitraryLoads;
module.exports.applyNetworkSecurityConfigAttribute = applyNetworkSecurityConfigAttribute;
module.exports.NETWORK_SECURITY_CONFIG = NETWORK_SECURITY_CONFIG;
