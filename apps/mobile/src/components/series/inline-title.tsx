import type { ComponentProps } from 'react';

import { ThemedText } from '@/components/themed-text';
import { NATIVE_HEADER } from '@/hooks/use-native-header';

/** The series' title at the top of the page's list. Not under the system bar, which carries it. */
export function InlineSeriesTitle(props: ComponentProps<typeof ThemedText>) {
  if (NATIVE_HEADER) return null;
  return <ThemedText {...props} />;
}
