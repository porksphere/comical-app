import { afterEach, describe, expect, test } from 'bun:test';

import { paneKey, setPaneTab } from './pane-tab';
import {
  clearSidebarSearches,
  isSidebarSearchOpen,
  setSidebarSearchTyped,
  sidebarSearchKeys,
  submitSidebarSearch,
} from './sidebar-search';

afterEach(() => {
  clearSidebarSearches();
  setPaneTab('browse');
});

describe('the search pane', () => {
  test('opens on Browse as soon as something is typed', () => {
    setPaneTab(paneKey('browse', 'comical'));
    setSidebarSearchTyped('wish');
    expect(isSidebarSearchOpen()).toBe(true);
  });

  test.each(['history', 'activity', paneKey('library', 'all')])(
    'waits for a submit on %s, where typing narrows the tab in place',
    (key) => {
      setPaneTab(key);
      setSidebarSearchTyped('wish');
      expect(isSidebarSearchOpen()).toBe(false);
      expect(sidebarSearchKeys()).toEqual([]);
      submitSidebarSearch('wish');
      expect(isSidebarSearchOpen()).toBe(true);
      expect(sidebarSearchKeys()).toEqual([key]);
    },
  );

  test('whitespace alone opens nothing anywhere', () => {
    setPaneTab(paneKey('browse', 'comical'));
    setSidebarSearchTyped('   ');
    expect(isSidebarSearchOpen()).toBe(false);
  });
});
