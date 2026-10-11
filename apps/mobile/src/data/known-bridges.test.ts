import { describe, expect, test } from 'bun:test';

import { bridgeIdOfRequest, isMissingBridgeRequest, knownBridges } from './known-bridges';
import { toLibraryCard } from './library-card';
import type { Bridge, LibraryItem } from './types';

const installed: Bridge = { id: 'panelfox', name: 'PanelFox', nsfw: false, capabilities: ['search'] };

const item = (bridgeId: string): LibraryItem => ({
  bridgeId,
  seriesId: 's1',
  title: 'Series',
  unread: 0,
  known: 3,
  readState: 'behind',
  collectedAt: 1,
});

describe('knownBridges', () => {
  test('keeps installed bridges as they are and marks missing ones not installed', () => {
    const known = knownBridges(
      [installed],
      [{ id: 'gone', name: 'Gone Direct', nsfw: true, capabilities: ['direct'], registryUrl: 'https://r.example/index.json' }],
    );
    expect(known.get('panelfox')).toEqual(installed);
    expect(known.get('gone')).toEqual({
      id: 'gone',
      name: 'Gone Direct',
      nsfw: true,
      capabilities: ['direct'],
      installed: false,
      registryUrl: 'https://r.example/index.json',
    });
  });

  test('a bridge the host knows nothing about is named by its id and treated as safe', () => {
    expect(knownBridges([], [{ id: 'mystery' }]).get('mystery')).toEqual({
      id: 'mystery',
      name: 'mystery',
      nsfw: false,
      capabilities: [],
      installed: false,
    });
  });

  test('installed wins when a reinstall lands between the two fetches', () => {
    const known = knownBridges([installed], [{ id: 'panelfox', name: 'Old name', nsfw: true }]);
    expect(known.get('panelfox')).toBe(installed);
  });
});

describe('toLibraryCard', () => {
  test('an installed bridge gives a plain card', () => {
    const card = toLibraryCard(item('panelfox'), installed);
    expect(card.sub).toBe('PanelFox');
    expect(card.unavailable).toBeUndefined();
    expect(card.direct).toBe(false);
  });

  test('an uninstalled bridge greys the card, keeps its name and opens it the right way', () => {
    const gone = knownBridges([], [{ id: 'gone', name: 'Gone Direct', capabilities: ['direct'] }]).get('gone');
    const card = toLibraryCard(item('gone'), gone);
    expect(card.unavailable).toBe(true);
    expect(card.sub).toBe('Gone Direct · Not installed');
    expect(card.bridge).toBe('Gone Direct');
    expect(card.direct).toBe(true);
  });

  test('a bridge known to nobody falls back to its id, not greyed', () => {
    const card = toLibraryCard(item('mystery'));
    expect(card.sub).toBe('mystery');
    expect(card.unavailable).toBeUndefined();
  });
});

describe('isMissingBridgeRequest', () => {
  const missing = [{ id: 'gone.scope' }];

  test('a request to an uninstalled bridge', () => {
    expect(bridgeIdOfRequest('/bridges/gone.scope/series/s1/chapters/c1/pages')).toBe('gone.scope');
    expect(bridgeIdOfRequest('/bridges/a%2Fb?x=1')).toBe('a/b');
    expect(isMissingBridgeRequest('/bridges/gone.scope/series/s1', [installed], missing)).toBe(true);
  });

  test('installed bridges, other routes and unknown paths still report', () => {
    expect(isMissingBridgeRequest('/bridges/panelfox/series/s1', [installed], missing)).toBe(false);
    // Reinstalled, while the missing list hasn't refetched yet.
    expect(isMissingBridgeRequest('/bridges/gone.scope/x', [installed, { ...installed, id: 'gone.scope' }], missing)).toBe(
      false,
    );
    expect(isMissingBridgeRequest('/library/collected/series/gone.scope/s1', [installed], missing)).toBe(false);
    expect(isMissingBridgeRequest(undefined, [installed], missing)).toBe(false);
    expect(bridgeIdOfRequest('/bridges')).toBeUndefined();
  });
});
