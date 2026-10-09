/**
 * What the desktop shell asks of the page: a route to open (a `comical://` link, a click on a
 * new-chapters notice) and the mouse's back and forward buttons.
 */
import { useEffect } from 'react';

import { desktopShell } from '@/lib/desktop-shell';
import { router } from '@/lib/nav';
import { deliverOAuthReturn } from '@/lib/oauth-return';
import { closeSeriesPane, isSeriesPaneOpen } from '@/lib/series-pane';

/**
 * Back closes whatever is over the page before it leaves the page. Everything that closes on Escape
 * — the reader, sheets, menus, the settings panel — is asked the same way Escape asks it, and one
 * that answers cancels the event. The series pane has no history entry and no Escape of its own, so
 * it comes next; only then does the page go back.
 */
function goBack(): void {
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  if (!document.dispatchEvent(escape)) return;
  if (isSeriesPaneOpen()) return closeSeriesPane();
  window.history.back();
}

const goForward = () => window.history.forward();

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
