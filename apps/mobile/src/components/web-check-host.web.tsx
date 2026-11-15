/**
 * On the web a page can't read another site's cookies, so only the desktop shell runs web checks,
 * in a window of its own; a browser tab has no runner, and the retry block says so.
 */
import { useEffect } from 'react';

import { registerWebCheckRunner } from '@/data/web-check';
import { desktopShell } from '@/lib/desktop-shell';

export function WebCheckHost() {
  useEffect(() => {
    const webCheck = desktopShell()?.webCheck;
    return webCheck ? registerWebCheckRunner((c) => webCheck(c.userAgent ? { url: c.url, userAgent: c.userAgent } : { url: c.url })) : undefined;
  }, []);
  return null;
}
