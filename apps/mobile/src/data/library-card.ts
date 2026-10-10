import type { SeriesGridItem } from '@/components/series-grid';
import type { Bridge, LibraryItem } from '@/data/types';

// The Library is a CROSS-BRIDGE grid: unlike Browse/Search (one bridge for the whole grid), each
// entry carries its own bridge. `SeriesGridItem` already models that — the per-item bridge fields
// override the grid-level ones — so no Library-specific cell or item type is needed. Shared by the
// Library tab and the dedicated Library search screen so the mapping lives in exactly one place.
// The timestamps ride along for the grouping axes (see `libraryGroupOf`) — grid-inert otherwise.
export type LibraryGridItem = SeriesGridItem & { collectedAt?: number; lastReadAt?: number };

/** Map a cross-bridge library entry to a grid card, resolving its bridge's display name + direct-ness. */
export function toLibraryCard(e: LibraryItem, bridge?: Bridge): LibraryGridItem {
  const unavailable = bridge?.installed === false;
  const name = bridge?.name ?? e.bridgeId;
  return {
    id: e.seriesId,
    title: e.title,
    cover: e.thumbnailUrl ?? '',
    sub: unavailable ? `${name} · Not installed` : name,
    ...(unavailable && { unavailable }),
    ...(e.unread > 0 && { unread: e.unread }),
    bridgeId: e.bridgeId,
    ...(bridge?.name && { bridge: bridge.name }),
    direct: bridge?.capabilities.includes('direct') ?? false,
    collectedAt: e.collectedAt,
    ...(e.lastReadAt !== undefined && { lastReadAt: e.lastReadAt }),
  };
}
