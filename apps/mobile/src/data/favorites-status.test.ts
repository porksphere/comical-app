import { describe, expect, test } from 'bun:test';

import type { BridgeSummary } from '@/data/api';
import { favoritesStatusOf } from '@/data/favorites-status';

const summary = (over: Partial<BridgeSummary> & { capabilities?: string[] }): BridgeSummary =>
  ({
    info: { id: 'b', name: 'B', capabilities: over.capabilities ?? ['favorites'] },
    configured: true,
    missingRequired: [],
    source: 'local',
    ...over,
  }) as unknown as BridgeSummary;

const token = { type: 'string', key: 'sessionToken', label: 'Token', secret: true } as const;
const baseUrl = { type: 'string', key: 'baseUrl', label: 'URL', required: true } as const;

describe('favoritesStatusOf', () => {
  test('a bridge without the capability is unsupported, whatever its settings say', () => {
    expect(favoritesStatusOf(summary({ capabilities: ['search'], settings: [token], secretsSet: ['sessionToken'] }))).toBe('unsupported');
  });

  test('a missing required setting needs the user in settings first', () => {
    expect(favoritesStatusOf(summary({ missingRequired: ['apiKey'] }))).toBe('login');
  });

  test('an optional login is the case missingRequired cannot see: no secret set means login', () => {
    expect(favoritesStatusOf(summary({ settings: [baseUrl, token], secretsSet: [] }))).toBe('login');
    expect(favoritesStatusOf(summary({ settings: [baseUrl, token], secretsSet: ['sessionToken'] }))).toBe('available');
  });

  test('any one secret counts as logged in, and OAuth tokens are secrets', () => {
    const pin = { type: 'oauth-pin', key: 'account', label: 'Account', authUrl: 'https://x' } as const;
    expect(favoritesStatusOf(summary({ settings: [token, pin], secretsSet: ['account'] }))).toBe('available');
  });

  test('a bridge with no secret descriptors is login-less: available', () => {
    expect(favoritesStatusOf(summary({ settings: [baseUrl], secretsSet: [] }))).toBe('available');
  });

  test('an older server that omits secretsSet is unknown, never logged out', () => {
    expect(favoritesStatusOf(summary({ settings: [token] }))).toBe('available');
    expect(favoritesStatusOf(summary({}))).toBe('available');
  });
});
