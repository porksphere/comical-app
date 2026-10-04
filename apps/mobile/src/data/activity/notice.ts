/**
 * The new-chapters notice's text — the same on a phone (`./background.ts`) and the desktop
 * (`./desktop-check.ts`).
 */
import * as api from '../api';
import { getNotifyPrefsSync } from './prefs';

export const NEW_CHAPTERS_TITLE = 'New chapters';

/** "One Piece, Berserk and 2 more", or the bare count when the feed can't be read. */
export async function newChaptersBody(count: number): Promise<string> {
  return (await seriesSummary()) ?? `${count} new chapter${count === 1 ? '' : 's'} in your library`;
}

/** Names of the most recent unread finds, e.g. "One Piece, Berserk and 2 more". Null on any miss. */
async function seriesSummary(): Promise<string | null> {
  try {
    const items = await api.getActivity({ caughtUpOnly: getNotifyPrefsSync().caughtUpOnly });
    const titles: string[] = [];
    for (const item of items) {
      if (item.read) continue;
      if (!titles.includes(item.title)) titles.push(item.title);
    }
    if (titles.length === 0) return null;
    if (titles.length <= 3) return titles.join(', ');
    return `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
  } catch {
    return null;
  }
}
