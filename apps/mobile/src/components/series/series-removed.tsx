import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ContinuousCorner, Spacing } from '@/constants/theme';
import { setSearchIntent } from '@/data/search-intent';
import { COMICAL_BRIDGE_ID } from '@/data/selected-bridge';
import type { SeriesDetail } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useRouter } from '@/lib/nav';
import { encodeSeriesParam, useDrillRelatedSeries, useOpenSearchLayer } from '@/lib/series-nav';

/** The reason a bridge gives when it has nothing more specific — not worth repeating under the heading. */
const GENERIC_REASON = 'removed from the source';

function NoticeAction({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="button">
      <ThemedText type="smallBold" style={{ color: disabled ? theme.textSecondary : theme.accent }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/**
 * The source has said this series no longer exists there. What was saved — details, progress,
 * downloads — is kept and stays readable; this says why the rest isn't, and points elsewhere.
 * `plate` draws it among the page's content; without it, it stands in for a page with nothing saved.
 */
export function SeriesRemovedNotice({
  bridgeName,
  title,
  reason,
  confirmed,
  saved,
  checking,
  onCheckAgain,
  onRemove,
  plate,
}: {
  bridgeName: string;
  title: string;
  reason: string;
  /** Only one answer so far — it may still come back. */
  confirmed: boolean;
  /** Collected — so there are saved details and maybe downloads to keep reading. */
  saved: boolean;
  checking: boolean;
  onCheckAgain: () => void;
  onRemove?: () => void;
  plate?: boolean;
}) {
  const router = useRouter();
  const openSearchLayer = useOpenSearchLayer();
  const findElsewhere = () => {
    setSearchIntent({ bridgeId: COMICAL_BRIDGE_ID, kind: 'query', query: title });
    if (openSearchLayer) openSearchLayer();
    else router.push('/search');
  };

  const source = bridgeName || 'the source';
  const lines = [
    reason.toLowerCase() !== GENERIC_REASON ? `${reason}.` : null,
    saved
      ? "Your saved details, reading progress and downloads are kept — chapters you haven't downloaded can't be read."
      : "It wasn't in your library, so there's nothing saved to read.",
    confirmed ? null : `${source} may just be having trouble — Comical will check again.`,
  ].filter((l): l is string => l !== null);

  const body = (
    <>
      <ThemedText type="smallBold" style={!plate && styles.centered}>
        Removed from {source}
      </ThemedText>
      {lines.map((l) => (
        <ThemedText key={l} type="small" themeColor="textSecondary" style={!plate && styles.centered}>
          {l}
        </ThemedText>
      ))}
      <View style={[styles.actions, !plate && styles.actionsCentered]}>
        <NoticeAction testID="series.removed.findElsewhere" label="Find on another source" onPress={findElsewhere} />
        <NoticeAction
          testID="series.removed.checkAgain"
          label={checking ? 'Checking…' : 'Check again'}
          onPress={onCheckAgain}
          disabled={checking}
        />
        {saved && onRemove ? (
          <NoticeAction testID="series.removed.removeFromLibrary" label="Remove from library" onPress={onRemove} />
        ) : null}
      </View>
    </>
  );

  return plate ? (
    <ThemedView testID="series.removed" type="backgroundElement" style={styles.plate}>
      {body}
    </ThemedView>
  ) : (
    <View testID="series.removed" style={styles.block}>
      {body}
    </View>
  );
}

/** Still on the source and readable, but hidden from its listings or superseded by a newer upload. */
export function SeriesDelistedNotice({
  delisted,
  bridgeId,
  bridgeName,
  direct,
}: {
  delisted: NonNullable<SeriesDetail['delisted']>;
  bridgeId?: string;
  bridgeName: string;
  direct: boolean;
}) {
  const router = useRouter();
  const drill = useDrillRelatedSeries();
  const { newerVersionId } = delisted;
  const openNewer = () => {
    if (!bridgeId || !newerVersionId) return;
    const params = {
      id: newerVersionId,
      bridgeId,
      bridge: encodeSeriesParam(bridgeName),
      ...(direct ? { direct: '1' } : {}),
    };
    if (drill) drill(params);
    else router.push({ pathname: '/series', params });
  };

  return (
    <ThemedView testID="series.delisted" type="backgroundElement" style={styles.plate}>
      <ThemedText type="small" themeColor="textSecondary">
        {delisted.reason ?? `Hidden on ${bridgeName || 'the source'}`}. It can still be read.
      </ThemedText>
      {newerVersionId && bridgeId ? (
        <NoticeAction testID="series.delisted.openNewer" label="Open the newer version" onPress={openNewer} />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  plate: {
    ...ContinuousCorner,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  block: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.four,
    rowGap: Spacing.two,
    marginTop: Spacing.one,
  },
  actionsCentered: {
    justifyContent: 'center',
  },
});
