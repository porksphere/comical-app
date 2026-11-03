import { createContext, use, type ComponentProps } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';

/** Where the series page wants to know how tall its title came out, wrapped lines included. */
export const InlineTitleHeightContext = createContext<SharedValue<number> | null>(null);

/** The series' title at the top of the page's list. */
export function InlineSeriesTitle(props: ComponentProps<typeof ThemedText>) {
  const height = use(InlineTitleHeightContext);
  return <ThemedText {...props} onLayout={height ? (e) => height.set(e.nativeEvent.layout.height) : undefined} />;
}
