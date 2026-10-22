import { useCallback } from 'react';

import { showToast } from '@/components/toast';
import { useDataSource } from '@/data/source';
import { useBridgeMap } from '@/hooks/use-bridges';
import { friendlyError } from '@/lib/friendly-error';
import { useRouter } from '@/lib/nav';
import { encodeSeriesParam } from '@/lib/series-nav';

/** The pasted text as a web link, or undefined when it is a search query. */
export function webLink(text: string): string | undefined {
  const url = text.trim();
  return /^https?:\/\/\S+$/i.test(url) ? url : undefined;
}

/**
 * A search field's submit for text that is a web link: opens the series (or the chapter, in the
 * reader) through the installed bridge that covers the site. Returns false for anything that isn't a
 * link, so the caller searches for it as usual.
 */
export function useOpenLink(): (text: string) => boolean {
  const ds = useDataSource();
  const router = useRouter();
  const { nameOf, directOf } = useBridgeMap();

  return useCallback(
    (text: string) => {
      const url = webLink(text);
      if (!url) return false;
      ds.resolveLink(url).then(
        (res) => {
          if (!res.ok) {
            const host = url.replace(/^https?:\/\/(?:www\.)?([^/?#]+).*$/i, '$1');
            showToast(
              res.reason === 'no-bridge' ? `No installed source opens links from ${host}` : "This page isn't a series a source can open",
              { tone: 'error' },
            );
            return;
          }
          const { bridgeId, seriesId, chapterId } = res.target;
          router.push({
            pathname: '/series',
            params: {
              id: seriesId,
              bridge: encodeSeriesParam(nameOf(bridgeId)),
              bridgeId,
              ...(directOf(bridgeId) ? { direct: '1' } : {}),
              ...(chapterId ? { reader: '1', start: '0', chapterId, chapterName: '' } : {}),
            },
          });
        },
        (err: unknown) => showToast(friendlyError(err, "Couldn't open this link right now. Try again."), { tone: 'error' }),
      );
      return true;
    },
    [ds, router, nameOf, directOf],
  );
}
