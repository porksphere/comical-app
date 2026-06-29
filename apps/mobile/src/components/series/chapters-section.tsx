import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Skeleton } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { coverDelayMs, relativeTime, type Chapter } from '@/data/mock';

// The series chapters block: tab filter (Overview / All / Read / Unread) + sort
// toggle (oldest/newest) over the chapter rows, with a "Show all" teaser on the
// Overview tab. For direct-series bridges, a page-thumbnail grid is rendered
// instead. Mirrors `#chapters-section` / `.page-thumb-grid` in the reference.

type Tab = 'overview' | 'all' | 'read' | 'unread';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'all', label: 'All' },
  { id: 'read', label: 'Read' },
  { id: 'unread', label: 'Unread' },
];
const OVERVIEW_LIMIT = 8;

export function ChaptersSection({
  chapters,
  pageThumbs,
}: {
  chapters?: Chapter[];
  pageThumbs?: string[];
}) {
  if (pageThumbs?.length) return <PageThumbGrid thumbs={pageThumbs} />;
  if (chapters?.length) return <ChapterList chapters={chapters} />;
  return null;
}

function ChapterList({ chapters }: { chapters: Chapter[] }) {
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('overview');
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    let list = chapters;
    if (tab === 'read') list = chapters.filter((c) => c.read);
    else if (tab === 'unread') list = chapters.filter((c) => !c.read);
    const sorted = [...list].sort((a, b) => (asc ? a.date - b.date : b.date - a.date));
    return tab === 'overview' ? sorted.slice(0, OVERVIEW_LIMIT) : sorted;
  }, [chapters, tab, asc]);

  const overflow = tab === 'overview' && chapters.length > OVERVIEW_LIMIT;

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <ThemedText type="subtitle" style={styles.headTitle}>
          Chapters
        </ThemedText>
        <View style={styles.controls}>
          <ThemedView type="backgroundElement" style={styles.tabs}>
            {TABS.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => setTab(t.id)}
                style={[styles.tab, tab === t.id && { backgroundColor: theme.accent }]}>
                <ThemedText
                  type="small"
                  style={[
                    styles.tabLabel,
                    tab === t.id ? { color: theme.accentOn } : { color: theme.textSecondary },
                  ]}>
                  {t.label}
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>
          <Pressable
            onPress={() => setAsc((v) => !v)}
            accessibilityLabel={asc ? 'Oldest first' : 'Newest first'}>
            <ThemedView type="backgroundElement" style={styles.sortBtn}>
              <ThemedText type="smallBold">{asc ? '↑' : '↓'}</ThemedText>
            </ThemedView>
          </Pressable>
        </View>
      </View>

      <View style={styles.list}>
        {rows.map((c) => (
          <ChapterRow key={c.id} chapter={c} />
        ))}
        {rows.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No chapters here.
          </ThemedText>
        )}
      </View>

      {overflow && (
        <Pressable onPress={() => setTab('all')}>
          <ThemedView type="backgroundElement" style={styles.showAll}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              Show all {chapters.length} chapters
            </ThemedText>
          </ThemedView>
        </Pressable>
      )}
    </View>
  );
}

function ChapterRow({ chapter }: { chapter: Chapter }) {
  const theme = useTheme();
  return (
    <Pressable style={({ pressed }) => [pressed && styles.rowPressed]}>
      <ThemedView type="backgroundElement" style={[styles.row, { borderColor: theme.hairline }]}>
        <ThemedText
          type="small"
          numberOfLines={1}
          style={[styles.rowName, chapter.read && { color: theme.textSecondary }]}>
          {chapter.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowTime}>
          {relativeTime(chapter.date)}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

// Rows shown before a long page set collapses behind "Show all".
const COLLAPSED_ROWS = 4;

function PageThumbGrid({ thumbs }: { thumbs: string[] }) {
  const theme = useTheme();
  const { width: screenW } = useWindowDimensions();
  const [containerW, setContainerW] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const cols = screenW >= 900 ? 5 : screenW >= 600 ? 3 : 2;
  const gap = Spacing.two;
  const tileW = containerW > 0 ? (containerW - gap * (cols - 1)) / cols : 0;

  // Past a few rows, collapse: a gradient fades the last visible rows out under
  // a centered "Show all" button so it reads as "there's more". Mirrors the
  // reference's `.page-thumbs-more`.
  const collapsedCount = cols * COLLAPSED_ROWS;
  const collapsed = !expanded && thumbs.length > collapsedCount;
  const shown = collapsed ? thumbs.slice(0, collapsedCount) : thumbs;
  const fadeHeight = tileW > 0 ? Math.round(tileW * (3 / 2) * 0.6) : 120;

  return (
    <View style={styles.section}>
      <ThemedText type="subtitle" style={styles.headTitle}>
        Pages
      </ThemedText>
      <View
        style={styles.thumbGridWrap}
        onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}>
        <View style={[styles.thumbGrid, { gap }]}>
          {tileW > 0 &&
            shown.map((uri, i) => <PageThumb key={uri} uri={uri} page={i + 1} width={tileW} />)}
        </View>

        {collapsed && (
          <View style={[styles.moreOverlay, { height: fadeHeight }]} pointerEvents="box-none">
            <GradientFade color={theme.background} />
            <Pressable onPress={() => setExpanded(true)} hitSlop={8}>
              <ThemedView
                type="backgroundElement"
                style={[styles.showMore, { borderColor: theme.hairline }]}>
                <ThemedText type="small" style={{ color: theme.accent }}>
                  Show all {thumbs.length} pages
                </ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

/** A single page tile: holds the image behind a simulated network delay and
 *  shows a shimmer skeleton until it's both elapsed and loaded — same treatment
 *  as the cover images, so a long page set visibly streams in. */
function PageThumb({ uri, page, width }: { uri: string; page: number; width: number }) {
  const [loaded, setLoaded] = useState(false);
  const delay = useMemo(() => coverDelayMs(uri), [uri]);
  const [delayPassed, setDelayPassed] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    setDelayPassed(false);
    setLoaded(false);
    const t = setTimeout(() => setDelayPassed(true), delay);
    return () => clearTimeout(t);
  }, [delay, uri]);
  const ready = delayPassed && loaded;
  return (
    <View style={[styles.thumb, { width }]}>
      {delayPassed && (
        <Image
          source={{ uri }}
          style={styles.thumbImg}
          contentFit="cover"
          transition={200}
          onLoad={() => setLoaded(true)}
        />
      )}
      {!ready && <Skeleton style={StyleSheet.absoluteFill} />}
      <View style={styles.pageNum}>
        <ThemedText style={styles.pageNumText}>{page}</ThemedText>
      </View>
    </View>
  );
}

/** A gentle vertical transparent→`color` fade over the last rows; only the very
 *  bottom reaches solid (where it meets the page background), so the button
 *  floats over the still-visible, fading thumbnails rather than a solid block. */
function GradientFade({ color }: { color: string }) {
  return (
    <LinearGradient
      colors={['transparent', color, color]}
      locations={[0, 0.8, 1]}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
  head: {
    gap: Spacing.two,
  },
  headTitle: {
    // Reference .chapters-head h3: 1.15rem (~18px).
    fontSize: 18,
    lineHeight: 24,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  tabs: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  tab: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 8,
  },
  tabLabel: {
    // Reference .ch-tab: 0.82rem (~13px).
    fontSize: 13,
  },
  sortBtn: {
    width: 36,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowName: {
    flex: 1,
    fontWeight: '600',
  },
  rowTime: {
    fontSize: 12,
  },
  empty: {
    paddingVertical: Spacing.three,
  },
  showAll: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: 8,
  },
  thumbGridWrap: {
    position: 'relative',
  },
  thumbGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  moreOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Button sits at the bottom of the cards, within the short fade.
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: Spacing.three,
  },
  showMore: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  thumb: {
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  pageNum: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pageNumText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
});
