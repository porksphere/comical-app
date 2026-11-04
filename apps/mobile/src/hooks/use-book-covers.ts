import { use$ } from '@legendapp/state/react';

import { readerDefaults, useSeriesReaderMode } from '@/hooks/use-reader-settings';
import { BOOK_COVERS, coverBinding, coverForm, type BookCover } from '@/lib/book-cover';
import { persisted$ } from '@/lib/observable';

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
const bookCovers$ = persisted$('comical:bookCovers', { enabled: true });

/** Whether cards are drawn as books (Settings → General). A `use`-prefixed wrapper, never a bare
 *  `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useBookCoversEnabled(): boolean {
  return use$(bookCovers$.enabled) ?? true;
}

export function setBookCovers(enabled: boolean): void {
  bookCovers$.enabled.set(enabled);
}

type Defaults = 'off' | 'paged:ltr' | 'paged:rtl' | 'webtoon:ltr' | 'webtoon:rtl';

// Its own hook-named wrapper, not a bare `use$` beside the series-mode hook below: the React Compiler
// caches a bare `use$` after the first render once a real hook sits next to it (see
// `useSettingsValue` in use-reader-settings).
function useCoverDefaults(): Defaults {
  return use$((): Defaults => {
    if (!(bookCovers$.enabled.get() ?? true)) return 'off';
    const { mode, direction } = readerDefaults();
    return `${mode}:${direction}`;
  });
}

/**
 * How this card is drawn as a book, or `null` when book covers are off. A series the reader reads
 * vertically (its own mode, or the reader's when it has none) is unbound; the binding side follows the
 * reader's direction setting, the only place a direction is configured today.
 *
 * `aspect` is the cover's own shape, not the row's: a square cover in a row of portrait ones is still
 * square, and still drops its spine.
 *
 * Two subscriptions per card, both answering with a primitive, so a card re-renders only when its
 * answer changes. The returned cover is one of the shared `BOOK_COVERS`, never a fresh object.
 */
export function useBookCover({
  bridgeId,
  seriesId,
  direct,
  aspect,
}: {
  bridgeId?: string;
  seriesId: string;
  direct: boolean;
  aspect: number;
}): BookCover | null {
  const defaults = useCoverDefaults();
  const seriesMode = useSeriesReaderMode(defaults !== 'off' && bridgeId ? `${bridgeId}:${seriesId}` : null)?.mode;
  if (defaults === 'off') return null;
  const [readerMode, direction] = defaults.split(':');
  const form = coverForm({ aspect, direct, vertical: (seriesMode ?? readerMode) === 'webtoon' });
  return BOOK_COVERS[form][coverBinding(direction === 'rtl')];
}
