import { use, useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle, View } from 'react-native';
// Internal (see below): expo-router keeps a zoom source's id in this context and exports neither.
import { ZoomTransitionSourceContext } from 'expo-router/build/link/zoom/zoom-transition-context.js';

import { useTabRoute } from '@/lib/focused-tab';
import { Link, LinkTrigger, tabHref } from '@/lib/nav';

/**
 * iOS: the source of a system zoom for a push made in code, where `<Link>` only builds one out of a
 * press. The series page's strip is one: the Read button and the chapter rows open the reader out
 * of it as well as a tap on the strip itself. So are a History or Activity row's thumbnail and a page
 * tile in the details, whose presses do more than push.
 *
 * A Link with `<LinkTrigger withAppleZoom>` registers its child as the source under an id it keeps
 * in a context, and its press adds that id to the href's params, which is what the stack reads to
 * zoom the pushed screen out of the source and back into it on the pop. This renders that Link
 * around a view that never takes a press, hands the id to `onId` while the source is
 * registered, and `withZoomSource` adds it to a `router.push`: the push a press would have made.
 * The context and the param name are expo-router internals, so either moving in an update leaves
 * the id null and the push a plain slide.
 *
 * `style` must give the view its size in flow: the native source wraps it and takes its size from
 * it, so an absolutely positioned view would register a rect of nothing.
 */
export function ZoomSource({
  href,
  onId,
  style,
}: {
  href: Parameters<typeof Link>[0]['href'];
  onId: (id: string | null) => void;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <Link push href={href} asChild testID="zoom-source">
      <LinkTrigger withAppleZoom>
        {/* One style object: expo-router's Slot, which `asChild` clones through, rejects an array
            in development. */}
        <SourceView onId={onId} style={StyleSheet.flatten(style)} />
      </LinkTrigger>
    </Link>
  );
}

function SourceView({ onId, style }: { onId: (id: string | null) => void; style: StyleProp<ViewStyle> }) {
  const source = use(ZoomTransitionSourceContext);
  const id = source?.hasZoomSource ? source.identifier : null;
  useEffect(() => {
    onId(id);
    return () => onId(null);
  }, [id, onId]);
  return <View collapsable={false} pointerEvents="none" style={style} />;
}

/** The href a ZoomSource's Link names: `pathname` in the stack of the tab it is rendered under, the
 *  root route's outside the tabs. Null off iOS, where nothing zooms. */
export function useZoomHref(pathname: '/series' | '/series/read') {
  const tab = useTabRoute();
  return useMemo(() => (Platform.OS !== 'ios' ? null : tab ? tabHref(tab, pathname, {}) : pathname), [tab, pathname]);
}

/** A ZoomSource's id for a press handler to push with. Held in a ref, as it is only read at press
 *  time, so a source registering re-renders nothing: one per row or tile, on every mount. */
export function useZoomId() {
  const id = useRef<string | null>(null);
  const onId = useCallback((next: string | null) => {
    id.current = next;
  }, []);
  return [id, onId] as const;
}

const SOURCE_PARAM = '__internal_expo_router_zoom_transition_source_id';

/** Whether this page's push zoomed out of a source, a ZoomSource's or a zoom Link's. */
export function openedByZoom(params: object): boolean {
  return typeof (params as Record<string, unknown>)[SOURCE_PARAM] === 'string';
}

export function withZoomSource(params: Record<string, string>, id: string | null): Record<string, string> {
  return id ? { ...params, [SOURCE_PARAM]: id } : params;
}

/** Route params minus expo-router's own: a page reached by a zoom carries its source's id, which
 *  copied into the next push would zoom that page out of the card that opened the first. */
export function withoutRouterParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && !k.startsWith('__internal_expo_router')) out[k] = v;
  }
  return out;
}
