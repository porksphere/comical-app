import { use, useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
// Internal (see below): expo-router keeps a zoom source's id in this context and exports neither.
import { ZoomTransitionSourceContext } from 'expo-router/build/link/zoom/zoom-transition-context.js';

import { Link, LinkTrigger } from '@/lib/nav';

/**
 * iOS: the source of a system zoom for a push made in code, where `<Link>` only builds one out of a
 * press. The series page's strip is one: the Read button and the chapter rows open the reader out
 * of it as well as a tap on the strip itself.
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
        <SourceView onId={onId} style={style} />
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

const SOURCE_PARAM = '__internal_expo_router_zoom_transition_source_id';

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
