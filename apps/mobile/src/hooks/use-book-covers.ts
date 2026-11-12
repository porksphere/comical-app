import { use$, useSelector } from '@legendapp/state/react';
import { useQuery } from '@tanstack/react-query';
import { createContext, createElement, use, useCallback, useMemo, type ReactNode } from 'react';

import { queryKeys } from '@/data/queries';
import { useDataSource, useMockActive } from '@/data/source';
import { peekSeriesReaderMode, readerDefaults, useSeriesReaderMode } from '@/hooks/use-reader-settings';
import { resolveCover, shuffledHints, type BookCover, type CoverForm, type ReadingDirection } from '@/lib/book-cover';
import { persisted$ } from '@/lib/observable';

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
const bookCovers$ = persisted$('comical:bookCovers', { enabled: true, shuffle: false });

/** Whether cards are drawn as books (Settings → General). A `use`-prefixed wrapper, never a bare
 *  `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useBookCoversEnabled(): boolean {
  return use$(bookCovers$.enabled) ?? true;
}

export function setBookCovers(enabled: boolean): void {
  bookCovers$.enabled.set(enabled);
}

/** Every series drawn as a random kind of book (Settings → Developer) — see `shuffledHints`. */
export function useBookCoverShuffle(): boolean {
  return use$(bookCovers$.shuffle) ?? false;
}

export function setBookCoverShuffle(shuffle: boolean): void {
  bookCovers$.shuffle.set(shuffle);
}

type Defaults = 'off' | `${'paged' | 'webtoon'}:${'ltr' | 'rtl'}${'' | ':shuffle'}`;

// Its own hook-named wrapper, not a bare `use$` beside the hooks below: the React Compiler caches a
// bare `use$` after the first render once a real hook sits next to it (see `useSettingsValue` in
// use-reader-settings).
function useCoverDefaults(): Defaults {
  return use$((): Defaults => {
    if (!(bookCovers$.enabled.get() ?? true)) return 'off';
    const { mode, direction } = readerDefaults();
    return `${mode}:${direction}${bookCovers$.shuffle.get() ? ':shuffle' : ''}`;
  });
}

/** What every card's book is drawn from but its own series: whether books are on and the reader's
 *  defaults (`Defaults`), and each bridge's declared cover hints, by id, as `form|direction`. */
type CoverSource = { defaults: Defaults; bridgeHints: ReadonlyMap<string, string> };

const CoverSourceContext = createContext<CoverSource>({ defaults: 'off', bridgeHints: new Map() });

/**
 * Reads the covers' shared inputs once, for every card under it — mounted at the app root. Each card
 * read them itself before: the settings, the data source, the mock toggle and an observer of the
 * bridges query apiece, which a screen of cards rendering together (an iPhone Duo folding or opening,
 * a list's layout changing) paid once per card.
 */
export function BookCoverSourceProvider({ children }: { children: ReactNode }) {
  const defaults = useCoverDefaults();
  const ds = useDataSource();
  const mock = useMockActive();
  const { data } = useQuery({
    queryKey: queryKeys.bridges(mock),
    queryFn: ({ signal }) => ds.getBridges(signal),
    enabled: defaults !== 'off',
    // Down to a string, so the cards render again only when a bridge's declared hints do.
    select: (bridges) => bridges.map((b) => `${b.id}\t${b.coverForm ?? ''}|${b.readingDirection ?? ''}`).join('\n'),
  });
  const value = useMemo((): CoverSource => {
    const bridgeHints = new Map<string, string>();
    for (const line of (data ?? '').split('\n')) {
      const [id, hints] = line.split('\t');
      if (id && hints) bridgeHints.set(id, hints);
    }
    return { defaults, bridgeHints };
  }, [defaults, data]);
  return createElement(CoverSourceContext.Provider, { value }, children);
}

type CoverSeries = {
  bridgeId?: string;
  seriesId: string;
  direct: boolean;
  aspect: number;
  coverForm?: CoverForm;
  readingDirection?: ReadingDirection;
};

/** The series' own hints win, then its bridge's defaults; what neither says is guessed — see
 *  `resolveCover`. `reading` is `<mode>:<direction>[:shuffle]`, the reader's defaults. */
function coverOf(
  reading: string,
  bridgeHints: ReadonlyMap<string, string>,
  seriesMode: string | undefined,
  { bridgeId, seriesId, direct, aspect, coverForm, readingDirection }: CoverSeries,
): BookCover {
  const [bridgeForm, bridgeDirection] = ((bridgeId && bridgeHints.get(bridgeId)) || '|').split('|');
  const [readerMode, readerDirection, shuffle] = reading.split(':');
  const hints = shuffle
    ? shuffledHints(`${bridgeId ?? ''}:${seriesId}`)
    : {
        form: coverForm ?? ((bridgeForm || undefined) as CoverForm | undefined),
        direction: readingDirection ?? ((bridgeDirection || undefined) as ReadingDirection | undefined),
      };
  return resolveCover({
    form: hints.form,
    direction: hints.direction,
    readsVertically: (seriesMode ?? readerMode) === 'webtoon',
    readerRightToLeft: readerDirection === 'rtl',
    direct,
    aspect,
  });
}

/**
 * How this card is drawn as a book, or `null` when book covers are off.
 *
 * `aspect` is the cover's own shape, not the row's: a square cover in a row of portrait ones is still
 * square, and still drops its spine. The returned cover is one of the shared `BOOK_COVERS`, never a
 * fresh object.
 */
export function useBookCover(series: CoverSeries): BookCover | null {
  const { defaults, bridgeHints } = use(CoverSourceContext);
  const on = defaults !== 'off';
  const seriesMode = useSeriesReaderMode(on && series.bridgeId ? `${series.bridgeId}:${series.seriesId}` : null)?.mode;
  if (!on) return null;
  return coverOf(defaults, bridgeHints, seriesMode, series);
}

/**
 * `useBookCover`'s answer for any series, for a place that draws a list of books in one component
 * (the home bookshelf) where a hook apiece can't be called. It differs in two ways: a series' own
 * reader mode is read as it stands rather than followed, and a book is returned with book covers
 * off too, since what asks is drawing books either way.
 */
export function useBookCoverResolver(): (series: CoverSeries & { bridgeId: string }) => BookCover {
  const { defaults, bridgeHints } = use(CoverSourceContext);
  // With book covers off the context carries no reading defaults, and the shelf still follows them.
  const reader = useSelector(() => {
    const { mode, direction } = readerDefaults();
    return `${mode}:${direction}`;
  });
  const reading = defaults === 'off' ? reader : defaults;
  return useCallback(
    (series) => coverOf(reading, bridgeHints, peekSeriesReaderMode(`${series.bridgeId}:${series.seriesId}`)?.mode, series),
    [reading, bridgeHints],
  );
}
