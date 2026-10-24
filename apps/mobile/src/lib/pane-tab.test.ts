import { beforeEach, describe, expect, test } from 'bun:test';

import { closeBridgeSearchPane, isBridgeSearchPaneOpen, openBridgeSearchPane, setBridgeSearchPaneAvailable } from './bridge-search-pane';
import { isPaneTabLive, paneKey, paneKeyOf, paneKeyScope, paneKeyTab, setPaneTab, setTabPaneKeys } from './pane-tab';
import { closeResultsPane, isResultsPaneOpen, openResultsPane, setResultsPaneAvailable } from './results-pane';
import { closeSeriesPane, isSeriesPaneOpen, openSeriesPane, setSeriesPaneAvailable } from './series-pane';
import { closeSidebarSearch, isSidebarSearchOpen, submitSidebarSearch } from './sidebar-search';

// The stores are module state shared by the whole app, so each test starts from a rail with nothing
// open on any tab, on Browse.
beforeEach(() => {
  for (const set of [setSeriesPaneAvailable, setResultsPaneAvailable, setBridgeSearchPaneAvailable]) {
    set(false);
    set(true);
  }
  for (const tab of ['browse', 'library']) closeSidebarSearch(tab);
  setPaneTab('browse');
});

describe('per-tab panes', () => {
  test('what one tab opened is still open when you come back to it', () => {
    expect(openSeriesPane({ bridgeId: 'b', id: '1' })).toBe(true);
    setPaneTab('library');
    expect(isSeriesPaneOpen()).toBe(false);
    setPaneTab('browse');
    expect(isSeriesPaneOpen()).toBe(true);
  });

  test("closing on one tab leaves another tab's open", () => {
    openResultsPane({ bridgeId: 'b' });
    submitSidebarSearch('query');
    setPaneTab('library');
    openBridgeSearchPane();
    closeSeriesPane();
    closeResultsPane();
    closeBridgeSearchPane();
    closeSidebarSearch();
    setPaneTab('browse');
    expect(isResultsPaneOpen()).toBe(true);
    expect(isSidebarSearchOpen()).toBe(true);
    expect(isBridgeSearchPaneOpen()).toBe(false);
  });

  test('a tab can be named outright', () => {
    openSeriesPane({ bridgeId: 'b', id: '1' });
    setPaneTab('library');
    expect(isSeriesPaneOpen('browse')).toBe(true);
    closeSeriesPane('browse');
    expect(isSeriesPaneOpen('browse')).toBe(false);
  });

  test('losing the pane layout clears every tab', () => {
    openSeriesPane({ bridgeId: 'b', id: '1' });
    setPaneTab('library');
    openSeriesPane({ bridgeId: 'b', id: '2' });
    setSeriesPaneAvailable(false);
    setSeriesPaneAvailable(true);
    expect(isSeriesPaneOpen('browse')).toBe(false);
    expect(isSeriesPaneOpen('library')).toBe(false);
  });

  test('only the active tab, or no pane at all, is live', () => {
    setPaneTab('library');
    expect(isPaneTabLive(null)).toBe(true);
    expect(isPaneTabLive('library')).toBe(true);
    expect(isPaneTabLive('browse')).toBe(false);
  });
});

describe('per-scope keys', () => {
  test('a key carries the tab and its scope', () => {
    expect(paneKey('browse', 'pub.bridge')).toBe('browse/pub.bridge');
    expect(paneKey('history')).toBe('history');
    expect(paneKeyTab('browse/pub.bridge')).toBe('browse');
    expect(paneKeyScope('browse/pub.bridge')).toBe('pub.bridge');
    expect(paneKeyScope('history')).toBeNull();
  });

  test('what one bridge opened is still open when you come back to it', () => {
    setPaneTab(paneKey('browse', 'a'));
    expect(openSeriesPane({ bridgeId: 'a', id: '1' })).toBe(true);
    setPaneTab(paneKey('browse', 'b'));
    expect(isSeriesPaneOpen()).toBe(false);
    setPaneTab(paneKey('browse', 'a'));
    expect(isSeriesPaneOpen()).toBe(true);
  });

  test("a tab's destination leads to its current scope's key", () => {
    setTabPaneKeys({ browse: paneKey('browse', 'a'), library: paneKey('library', 'all') });
    expect(paneKeyOf('browse')).toBe('browse/a');
    expect(paneKeyOf('history')).toBe('history');
  });
});
