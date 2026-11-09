import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { BookCoverArt } from '@/components/book-chrome';
import type { SeriesEntry } from '@/data/types';
import { useBookCover } from '@/hooks/use-book-covers';
import { useResolvedAsset } from '@/hooks/use-resolved-asset';
import { PRINT } from '@/lib/book-cover';

/** The preview's widest, on a tablet or a desktop window. */
const MAX_WIDTH = 360;
/** The most of the window's height the cover may take, leaving the menu room beneath it. */
const MAX_HEIGHT_SHARE = 0.5;
/** How far a CG set's print, tipped behind the front one, reaches past the cover's box, of its
 *  height: what the preview leaves round the art so the platter doesn't cut its corners. */
const TIPPED_REACH = Math.sin((Math.abs(PRINT.tilt) * Math.PI) / 180) / 2;

/**
 * The size a held series' cover grows to: as large as `room` allows at the cover's own `aspect`
 * (width over height), capped so the menu still fits beneath it. What Books and Photos do with a
 * held item, and what both menus draw: iOS's system preview, Android's hold popup.
 */
export function coverPreviewSize(aspect: number, room: { width: number; height: number }): { width: number; height: number } {
  const width = Math.round(Math.min(room.width, MAX_WIDTH, room.height * MAX_HEIGHT_SHARE * aspect));
  return { width, height: Math.round(width / aspect) };
}

/** The book a held series is drawn as: the card's, from the same inputs the card reads. */
export function useEntryBook(bridgeId: string | undefined, entry: SeriesEntry, direct: boolean | undefined, aspect: number) {
  return useBookCover({
    bridgeId,
    seriesId: entry.id,
    direct: !!direct,
    aspect,
    coverForm: entry.coverForm,
    readingDirection: entry.readingDirection,
  });
}

/**
 * The cover alone, as the book the card draws, filling the box it is given: what iOS's system
 * context menu grows a held series into (series-card-menu.ios.tsx). UIKit's preview takes no touches
 * and casts its own shadow, so the book's is left out.
 */
export function SeriesCardPreview({
  bridgeId,
  entry,
  direct,
  aspect,
}: {
  bridgeId: string;
  entry: SeriesEntry;
  direct?: boolean;
  aspect: number;
}) {
  const book = useEntryBook(bridgeId, entry, direct, aspect);
  const uri = useResolvedAsset(entry.cover);
  const picture = uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" /> : null;
  return (
    <View style={styles.room}>
      <View style={[book?.form === 'sheets' ? styles.inset : styles.whole, { aspectRatio: aspect }]}>
        <BookCoverArt book={book} aspect={aspect} cover={uri} recyclingKey={entry.id} picture={picture} shadow={false} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  room: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whole: {
    height: '100%',
  },
  inset: {
    height: `${100 / (1 + 2 * TIPPED_REACH)}%`,
  },
});
