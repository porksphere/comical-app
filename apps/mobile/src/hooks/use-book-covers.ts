import { use$ } from '@legendapp/state/react';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { readerDefaults, useSeriesReaderMode } from '@/hooks/use-reader-settings';
import { resolveCover, type BookCover, type CoverForm, type ReadingDirection } from '@/lib/book-cover';
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

// Its own hook-named wrapper, not a bare `use$` beside the hooks below: the React Compiler caches a
// bare `use$` after the first render once a real hook sits next to it (see `useSettingsValue` in
// use-reader-settings).
function useCoverDefaults(): Defaults {
  return use$((): Defaults => {
    if (!(bookCovers$.enabled.get() ?? true)) return 'off';
    const { mode, direction } = readerDefaults();
    return `${mode}:${direction}`;
  });
}

/** The bridge's declared defaults, read off the one bridges query every card shares and selected down
 *  to a string, so a card re-renders only when its own bridge's answer changes. */
function useBridgeCoverHints(bridgeId: string | undefined, wanted: boolean): { form?: CoverForm; direction?: ReadingDirection } {
  const ds = useDataSource();
  const mock = useMockActive();
  const { data } = useQuery({
    queryKey: queryKeys.bridges(mock),
    queryFn: ({ signal }) => ds.getBridges(signal),
    enabled: wanted && !!bridgeId,
    select: (bridges) => {
      const b = bridges.find((x) => x.id === bridgeId);
      return `${b?.coverForm ?? ''}|${b?.readingDirection ?? ''}`;
    },
  });
  const [form, direction] = (data ?? '|').split('|');
  return { form: (form || undefined) as CoverForm | undefined, direction: (direction || undefined) as ReadingDirection | undefined };
}

/**
 * How this card is drawn as a book, or `null` when book covers are off. The series' own hints win,
 * then its bridge's defaults; what neither says is guessed — see `resolveCover`.
 *
 * `aspect` is the cover's own shape, not the row's: a square cover in a row of portrait ones is still
 * square, and still drops its spine. The returned cover is one of the shared `BOOK_COVERS`, never a
 * fresh object.
 */
export function useBookCover({
  bridgeId,
  seriesId,
  direct,
  aspect,
  coverForm,
  readingDirection,
}: {
  bridgeId?: string;
  seriesId: string;
  direct: boolean;
  aspect: number;
  coverForm?: CoverForm;
  readingDirection?: ReadingDirection;
}): BookCover | null {
  const defaults = useCoverDefaults();
  const on = defaults !== 'off';
  const bridge = useBridgeCoverHints(bridgeId, on && (coverForm === undefined || readingDirection === undefined));
  const seriesMode = useSeriesReaderMode(on && bridgeId ? `${bridgeId}:${seriesId}` : null)?.mode;
  if (!on) return null;
  const [readerMode, readerDirection] = defaults.split(':');
  return resolveCover({
    form: coverForm ?? bridge.form,
    direction: readingDirection ?? bridge.direction,
    readsVertically: (seriesMode ?? readerMode) === 'webtoon',
    readerRightToLeft: readerDirection === 'rtl',
    direct,
    aspect,
  });
}
