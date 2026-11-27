import { NativeTabHeader } from '@/components/native-tab-header';
import { TabFilterField, TabFilterTrigger, type TabFilter } from '@/components/tab-filter';
import { TabTitleBar } from '@/components/tab-title-bar';
import { useSidebarListsScopes } from '@/hooks/use-content-width';
import { NATIVE_HEADER } from '@/hooks/use-native-header';
import { readingViewLabel, type ReadingView } from '@/hooks/use-reading-view';

/** Each view's test ids, kept from when the views were tabs of their own. */
const IDS: Record<ReadingView, { id: string; placeholder: string }> = {
  history: { id: 'history', placeholder: 'Filter history…' },
  new: { id: 'activity', placeholder: 'Filter new chapters…' },
};

/**
 * The Reading tab's bar. Titled "Reading", the tab's name, where the screen switches between the
 * views itself; the view's own name where the sidebar lists the views and is the switch.
 */
export function ReadingBar({ view, filter }: { view: ReadingView; filter: TabFilter }) {
  const listed = useSidebarListsScopes();
  const title = listed ? readingViewLabel(view) : 'Reading';
  const { id, placeholder } = IDS[view];
  if (NATIVE_HEADER) return <NativeTabHeader title={title} filter={filter} placeholder={placeholder} />;
  return (
    <TabTitleBar
      title={title}
      holdTestID={`${id}.nsfw-hold`}
      titleSlot={filter.open ? <TabFilterField filter={filter} testID={`${id}.search`} placeholder={placeholder} /> : undefined}
      right={<TabFilterTrigger filter={filter} testID={`${id}.search`} placeholder={placeholder} />}
    />
  );
}
