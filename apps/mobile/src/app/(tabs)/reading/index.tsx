import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { ActivityView } from '@/components/reading/activity-view';
import { HistoryView } from '@/components/reading/history-view';
import { useDeferredMount } from '@/hooks/use-deferred-mount';
import { parseReadingView, setReadingView, useReadingView } from '@/hooks/use-reading-view';
import { useRouter } from '@/lib/nav';

/** The Reading tab: History or New chapters, whichever view is chosen (see `use-reading-view`). */
export default function ReadingScreen() {
  const view = useReadingView();
  // Gated here rather than in each view: the tab's first mount waits a beat for the list, a switch
  // between the views (this screen staying mounted) never does, or each switch flashed Loading.
  const ready = useDeferredMount();
  const router = useRouter();
  // A link can name the view (a new-chapters notification opens `/reading?view=new`); it is applied
  // once and dropped from the route, so the switch is free to move afterwards.
  const { view: linked } = useLocalSearchParams<{ view?: string }>();
  useEffect(() => {
    const target = parseReadingView(linked);
    if (!target) return;
    setReadingView(target);
    router.setParams({ view: undefined });
  }, [linked, router]);
  return view === 'new' ? <ActivityView ready={ready} /> : <HistoryView ready={ready} />;
}
