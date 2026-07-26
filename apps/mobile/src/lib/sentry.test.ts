import { describe, expect, test } from 'bun:test';

import { isE2eBuildChannel } from './sentry';

describe('isE2eBuildChannel', () => {
  test('CI E2E channels (ios-e2e, android-e2e)', () => {
    expect(isE2eBuildChannel('ios-e2e')).toBe(true);
    expect(isE2eBuildChannel('android-e2e')).toBe(true);
  });

  test('every other channel, including a developer simulator run', () => {
    expect(isE2eBuildChannel('local-dev')).toBe(false);
    expect(isE2eBuildChannel('ios-devclient')).toBe(false);
    expect(isE2eBuildChannel('ios-main')).toBe(false);
    expect(isE2eBuildChannel('ios-pr')).toBe(false);
    expect(isE2eBuildChannel('ios-release')).toBe(false);
  });
});
