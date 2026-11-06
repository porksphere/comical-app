import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { edgeOffset, pageRest, panLimits, type Size } from '@/components/reader/page-geometry';
import type { ReaderPageItem } from '@/components/reader/paged-reader';
import { ReaderPage, STANDBY_FADE_MS } from '@/components/reader/reader-page';
import { spreadImage } from '@/components/reader/spreads';
import type { PageFit } from '@/hooks/use-reader-settings';

/** How the list under the poster lays out where it opens. */
export type PosterLayout =
  /** The pager's: the start page, or the spread holding it, at the page's rest. */
  | 'page'
  /** The paginated webtoon's: one page contained in the viewport, at 1×. */
  | 'contain'
  /** The continuous webtoon's: full-width rows, the start page's top at the top. */
  | 'column';

/** THE INITIAL-POSITION POSTER: where the reader opens, drawn over the list until the list shows it
 *  (see `posterUp` in ReaderPane). It is the list's own drawing — the rows' `ReaderPage`, the
 *  pager's box, scale and edge — because the hand-over is only invisible if the two agree to the
 *  point: a contain picture handing over to a page resting at fit-height, or to a strip shown from
 *  its top, is the flash it exists to hide. */
export function StartPoster({
  layout,
  pages,
  sizeOf,
  width,
  height,
  pageFit,
  rtl,
  standby,
}: {
  layout: PosterLayout;
  /** The start spread's halves, a blank half null — or, for a column, its first rows. */
  pages: (ReaderPageItem | null)[];
  /** A page's picture size, where the list has reported it or it has been seen before. */
  sizeOf: (page: ReaderPageItem) => Size | undefined;
  width: number;
  height: number;
  pageFit: PageFit;
  rtl: boolean;
  standby: boolean;
}) {
  // The poster's own pictures can land before the list's report of the same ones.
  const [own, setOwn] = useState<Record<string, Size>>({});
  const fadeMs = standby ? STANDBY_FADE_MS : undefined;

  if (layout === 'column') {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
        {pages.map((p) => p && <ReaderPage key={p.key} uri={p.uri} page={p.pageNumber} fit="width" width={width} fadeMs={fadeMs} />)}
      </View>
    );
  }

  const viewport = { width, height };
  const known = (p: ReaderPageItem) => own[p.key] ?? sizeOf(p) ?? null;
  const double = pages.length > 1;
  const image = double ? spreadImage(pages.map((p) => (p ? known(p) : undefined)), viewport) : known(pages[0]!);
  const rest = layout === 'contain' ? pageRest(image, viewport, pageFit, false, rtl, true) : pageRest(image, viewport, pageFit, double, rtl, standby);
  const off = edgeOffset(rest.restEdge, panLimits(rest.restScale, rest.content, viewport));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <View
        style={[
          { width, height, transform: [{ translateX: off.x }, { translateY: off.y }, { scale: rest.restScale }] },
          styles.centred,
          double && (rtl ? styles.rowReverse : styles.row),
        ]}
      >
        {pages.map((p, i) =>
          !p ? (
            <View key="blank" style={{ width: width / 2, height }} />
          ) : (
            <ReaderPage
              key={`${p.uri}:${pages.length}`}
              fadeMs={fadeMs}
              uri={p.uri}
              page={p.pageNumber}
              fit="contain"
              width={double ? width / 2 : width}
              height={rest.strip ? rest.content.height : height}
              contentPosition={double ? ((i === 0) !== rtl ? 'right' : 'left') : undefined}
              boxIsFinal={layout === 'contain' || double || pageFit !== 'fit-width'}
              onLoadDims={(w, h) => setOwn((prev) => (prev[p.key] ? prev : { ...prev, [p.key]: { width: w, height: h } }))}
            />
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
});
