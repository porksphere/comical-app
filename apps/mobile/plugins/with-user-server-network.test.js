const { describe, expect, test } = require('bun:test');
const {
  applyIosArbitraryLoads,
  applyNetworkSecurityConfigAttribute,
  NETWORK_SECURITY_CONFIG,
} = require('./with-user-server-network.js');

describe('applyIosArbitraryLoads', () => {
  test('replaces the ATS dictionary so NSAllowsLocalNetworking cannot cancel arbitrary loads', () => {
    const out = applyIosArbitraryLoads({
      name: 'Comical',
      ios: {
        bundleIdentifier: 'x',
        infoPlist: {
          UIViewControllerBasedStatusBarAppearance: true,
          NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSAllowsArbitraryLoads: false },
        },
      },
    });
    expect(out.ios.infoPlist.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: true });
    expect(out.ios.infoPlist.UIViewControllerBasedStatusBarAppearance).toBe(true);
    expect(out.ios.bundleIdentifier).toBe('x');
  });

  test('works on a config with no ios section', () => {
    expect(applyIosArbitraryLoads({ name: 'C' }).ios.infoPlist.NSAppTransportSecurity).toEqual({
      NSAllowsArbitraryLoads: true,
    });
  });
});

describe('applyNetworkSecurityConfigAttribute', () => {
  test('points <application> at the config and keeps its other attributes', () => {
    const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    const app = applyNetworkSecurityConfigAttribute(manifest).manifest.application[0];
    expect(app.$['android:networkSecurityConfig']).toBe('@xml/network_security_config');
    expect(app.$['android:name']).toBe('.MainApplication');
  });

  test('throws on a manifest without <application>', () => {
    expect(() => applyNetworkSecurityConfigAttribute({ manifest: {} })).toThrow();
  });
});

test('the network security config allows cleartext and trusts system and user CAs', () => {
  expect(NETWORK_SECURITY_CONFIG).toContain('cleartextTrafficPermitted="true"');
  expect(NETWORK_SECURITY_CONFIG).toContain('<certificates src="system" />');
  expect(NETWORK_SECURITY_CONFIG).toContain('<certificates src="user" />');
});
