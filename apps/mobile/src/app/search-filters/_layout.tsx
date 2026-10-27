import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';

// The search filters' form sheet (see the root layout for its presentation) hosts its OWN native
// stack: the rows are `index`, and a `multi`/`includeExclude`/`tags` row pushes `editor` as a real
// card inside the sheet, with the slide and the edge swipe back. The custom bar's rows open those
// editors in the app-root overlay instead, which a system sheet would present over — see
// data/filter-sheet.ts.
export default function SearchFiltersLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerStyle: { backgroundColor: theme.backgroundPanel },
        headerTitleStyle: { color: theme.text },
        contentStyle: { backgroundColor: theme.backgroundPanel },
      }}>
      <Stack.Screen name="index" options={{ title: 'Filters' }} />
      {/* No title: the editor names the filter itself, as it does in the overlay. */}
      <Stack.Screen name="editor" options={{ title: '' }} />
    </Stack>
  );
}
