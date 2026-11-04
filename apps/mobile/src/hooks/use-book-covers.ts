import { use$ } from '@legendapp/state/react';

import { useDefaultReaderDirection, useDefaultReaderMode, useSeriesReaderMode } from '@/hooks/use-reader-settings';
import { coverBinding, coverForm, type BookCover } from '@/lib/book-cover';
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

/**
 * How this card is drawn as a book, or `null` when book covers are off. A series the reader reads
 * vertically (its own mode, or the reader's when it has none) is unbound; the binding side follows the
 * reader's direction setting, the only place a direction is configured today.
 *
 * `aspect` is the cover's own shape, not the row's: a square cover in a row of portrait ones is still
 * square, and still drops its spine.
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
  const enabled = useBookCoversEnabled();
  const seriesMode = useSeriesReaderMode(enabled && bridgeId ? `${bridgeId}:${seriesId}` : null)?.mode;
  const readerMode = useDefaultReaderMode();
  const rightToLeft = useDefaultReaderDirection() === 'rtl';
  if (!enabled) return null;
  return {
    form: coverForm({ aspect, direct, vertical: (seriesMode ?? readerMode) === 'webtoon' }),
    binding: coverBinding(rightToLeft),
  };
}

/** The binding a card with no series to ask about takes — a hidden card's paper wrap. */
export function useDefaultBinding(): BookCover['binding'] {
  return coverBinding(useDefaultReaderDirection() === 'rtl');
}
