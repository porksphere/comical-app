import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeftIcon } from '@/components/icons/chevron-left';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const BAR_HEIGHT = 44;
const HAIRLINE = 'rgba(128,128,128,0.25)';
const ACCENT = '#3478F6';

// Placeholder metadata. A real series would carry this from the bridge; the
// mock fills in representative values so the layout matches the reference.
const META = [
  { label: 'STATUS', value: 'Ongoing' },
  { label: 'TYPE', value: 'Manhwa' },
  { label: 'AUTHOR', value: 'Chi-U Kim, kiraz' },
  { label: 'ARTIST', value: 'Themis' },
];

const DESCRIPTION =
  'After Sirone was abandoned in a stable, he was found by a family of hunters and ' +
  'raised in a loving home. Despite the hardships of the peasant life, he learned how ' +
  'to read from a young age and became obsessed with books, especially ones on the ' +
  'history of magic. One day, he has an unlikely encounter with a mage and learns how ' +
  'to enter the "spirit zone", the first step to learning how to use magic. Although ' +
  'they say only nobles can be mages, will Sirone be able to defy the odds?';

export default function SeriesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id, title, bridge } = useLocalSearchParams<{
    id?: string;
    title?: string;
    bridge?: string;
  }>();

  const cover = `https://picsum.photos/seed/comical-${id ?? title ?? 'series'}/300/450`;

  return (
    <ThemedView style={styles.container}>
      {/* Static top bar: pinned above the scrolling content. Back button on the
          left, the originating bridge's name centred. */}
      <View style={[styles.topBar, { paddingTop: insets.top, height: insets.top + BAR_HEIGHT }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back">
          <ChevronLeftIcon color={theme.text} />
        </Pressable>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.bridgeName}>
          {bridge ?? 'Library'}
        </ThemedText>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Spacing.five },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.inner}>
          <ThemedText type="subtitle" style={styles.title}>
            {title ?? 'Untitled Series'}
          </ThemedText>

          <View style={styles.hero}>
            <View style={styles.coverWrap}>
              <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" transition={200} />
              <View style={styles.badge}>
                <ThemedText type="smallBold" style={styles.badgeText}>
                  176
                </ThemedText>
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable style={[styles.action, styles.primaryAction]}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.primaryLabel}>
                  ▶  Chapter 1 — Gam…
                </ThemedText>
              </Pressable>
              <ActionButton label="+  Library" />
              <ActionButton label="☆  Favorite" />
            </View>
          </View>

          <ThemedView type="backgroundElement" style={styles.metaRow}>
            {META.map((m) => (
              <View key={m.label} style={styles.metaCell}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.metaLabel}>
                  {m.label}
                </ThemedText>
                <ThemedText type="small" numberOfLines={2}>
                  {m.value}
                </ThemedText>
              </View>
            ))}
          </ThemedView>

          <ThemedText themeColor="textSecondary" style={styles.description}>
            {DESCRIPTION}
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function ActionButton({ label }: { label: string }) {
  return (
    <Pressable style={styles.action}>
      <ThemedView type="backgroundElement" style={styles.actionFill}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingBottom: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  backButton: {
    position: 'absolute',
    left: Spacing.three,
    bottom: Spacing.one,
    height: BAR_HEIGHT - Spacing.two,
    justifyContent: 'center',
  },
  bridgeName: {
    maxWidth: '70%',
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.four,
  },
  title: {
    lineHeight: 40,
  },
  hero: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  coverWrap: {
    width: 130,
  },
  cover: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 12,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  badge: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  badgeText: {
    color: '#ffffff',
  },
  actions: {
    flex: 1,
    gap: Spacing.two,
  },
  action: {
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  primaryAction: {
    backgroundColor: ACCENT,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    color: '#ffffff',
  },
  actionFill: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  metaCell: {
    flex: 1,
    gap: Spacing.half,
  },
  metaLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
  description: {
    lineHeight: 22,
  },
});
