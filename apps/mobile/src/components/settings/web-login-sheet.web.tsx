import type { WebLoginSetting } from '@/data/api';

/** A browser can't read another site's cookies: the desktop shell signs in itself, a tab pastes. */
export const canSignInNatively = false;

export function WebLoginSheet(_: { login: WebLoginSetting | null; onDone: (cookies: string | null) => void }) {
  return null;
}
