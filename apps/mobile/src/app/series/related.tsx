import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { SeriesReaderInstance, type SeriesReaderParams } from './index';
import { useRouter } from '@/lib/nav';

// A series drilled from another series (a related rail, a search result) as a REAL PUSH on the
// modal's nested stack, rather than the sibling LAYER it normally is.
//
// Only reachable while the `nativeSearchStack` experiment is on — see lib/experimental.ts for what
// the experiment is settling and what to watch. Delete both together.
//
// `depth` 1, not 0: depth 0 means "I am the modal root", which owns the tab-bar backdrop dim and
// leaves by popping the whole modal. This leaves by popping itself off the nested stack instead.
export default function DrilledSeriesRoute() {
  const params = useLocalSearchParams<SeriesReaderParams>();
  const router = useRouter();
  const pop = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);
  return <SeriesReaderInstance params={params} depth={1} onPopLayer={pop} />;
}
