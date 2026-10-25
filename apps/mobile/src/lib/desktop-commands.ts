/**
 * What the desktop shell asks of the page — a route to open (a `comical://` link, a click on a
 * new-chapters notice), the mouse's back and forward buttons — and the keys that do the same.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { closeBridgeSearchPane, isBridgeSearchPaneOpen } from '@/lib/bridge-search-pane';
import { desktopShell } from '@/lib/desktop-shell';
import { dismissKeyHeld } from '@/lib/dismiss-key';
import { letGoOfFocus } from '@/lib/focus-nav';
import { isTypingTarget } from '@/lib/key-hold';
import { keyActionOf } from '@/lib/keybindings';
import { router } from '@/lib/nav';
import { deliverOAuthReturn } from '@/lib/oauth-return';
import { closeResultsPane, isResultsPaneOpen } from '@/lib/results-pane';
import { isRootTabPath } from '@/lib/root-tabs';
import { closeSeriesPane, isSeriesPaneCovered, isSeriesPaneOpen } from '@/lib/series-pane';
import { openSettingsModal } from '@/lib/settings-modal';
import { closeSidebarSearch, isSidebarSearchOpen } from '@/lib/sidebar-search';

/**
 * What is left once nothing listening for Escape took it. The panes have no history entries, so
 * they come first, top one first; only then does the page go back — and never off the app's first
 * page, which in a browser would leave the app. A key stops at a tab too: the tabs are roots, and
 * Escape on Library has nothing to close, whatever the browser's history holds (Browse, from the
 * click that opened Library). A back button is history's, and leaves through it.
 */
function stepBack(key = false): void {
  if (isSeriesPaneOpen() && !isSeriesPaneCovered()) return closeSeriesPane();
  if (isResultsPaneOpen()) return closeResultsPane();
  if (isSidebarSearchOpen()) return closeSidebarSearch();
  if (isBridgeSearchPaneOpen()) return closeBridgeSearchPane();
  if (key && isRootTabPath(window.location.pathname)) return;
  if (router.canGoBack()) window.history.back();
}

/**
 * Back closes whatever is over the page before it leaves the page. Everything that closes on Escape
 * — the series page's layers, sheets, menus, the settings panel — is asked the same way Escape asks
 * it, and one that answers cancels the event.
 */
export function goBack(): void {
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  if (document.dispatchEvent(escape)) stepBack();
}

export const goForward = () => window.history.forward();

/**
 * Escape is the one key that always does something: out of a text field, then whatever is open
 * closes, then out of the keyboard's focus, then back.
 *
 * Out of a text field is decided on the capture, since react-native-web's TextInput stops every key
 * event at the field (its #612) and no bubbling listener sees one — unless a popup is open, which
 * takes Escape first (lib/dismiss-key) and keeps the field as it was, with the keys free once the
 * popup is gone.
 */
function onEscapeInField(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || !isTypingTarget(e.target) || dismissKeyHeld()) return;
  e.preventDefault();
  (e.target as HTMLElement).blur();
}

/**
 * The listeners that close things are window and document listeners added after this one, so
 * whether one took the key is only known once the event has finished dispatching. `goBack`'s own
 * Escape is left to `goBack`.
 */
function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') {
    if (e.isTrusted && !isTypingTarget(e.target)) {
      setTimeout(() => {
        if (e.defaultPrevented) return;
        if (!letGoOfFocus()) stepBack(true);
      });
    }
    return;
  }
  const step = isTypingTarget(e.target) ? null : keyActionOf(e, ['back', 'forward', 'shortcuts']);
  if (!step) return;
  e.preventDefault();
  if (step === 'back') goBack();
  else if (step === 'forward') goForward();
  else openSettingsModal({ category: 'shortcuts' });
}

/** Mounted above the navigator, so not through `useKeyboardShortcut`, which needs a screen. */
export function useNavigationKeys(): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    window.addEventListener('keydown', onEscapeInField, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onEscapeInField, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}

export function useDesktopShellCommands(): void {
  // A link that launched the app is handed over the moment this subscribes, so it subscribes once
  // the tree below — the root navigator — has mounted: this effect runs after its children's.
  // (It used to wait on `useRootNavigationState().key`, but that hook is a plain snapshot now, not a
  // subscription, so a first render without a key never re-rendered to see one, and nothing ever
  // subscribed.) The imperative router queues an action dispatched before the container is ready.
  useEffect(() => {
    const shell = desktopShell();
    if (!shell?.onShellCommand) return;
    const unsubscribe = shell.onShellCommand((command) => {
      if (command.type === 'open') {
        // A tracker sign-in bouncing back from the browser is an answer for the row that started
        // it, not a page.
        if (!deliverOAuthReturn(command.route)) router.navigate(command.route as Parameters<typeof router.navigate>[0]);
      } else if (command.dir === 'back') goBack();
      else goForward();
    });
    // Windows and Linux route the mouse's side buttons to the shell; macOS hands them to the page.
    if (shell.platform !== 'darwin') return unsubscribe;
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) goBack();
      else if (e.button === 4) goForward();
    };
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      unsubscribe();
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);
}
