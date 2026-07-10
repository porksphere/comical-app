import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { ContextMenu, Host, RNHostView, Toggle } from '@expo/ui/swift-ui';
import { disabled as disabledModifier } from '@expo/ui/swift-ui/modifiers';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * iOS variant of the per-card quick-actions menu. Android uses `series-card-menu.tsx` (@expo/ui
 * `MenuView` → a Compose dropdown, which has no lifted preview) and web `series-card-menu.web.tsx`.
 *
 * iOS gets its own file because we drive the SwiftUI `ContextMenu` directly (rather than the
 * community `MenuView`) so we can supply a **custom `Preview`**. Without one, iOS auto-snapshots the
 * trigger and lifts a scaled copy — which, for a card clipped inside a rail/grid, reads as an
 * awkward, clipped "scale up". The custom preview instead shows a clean cover + the FULL (unclamped)
 * title at a controlled size, which is also where the full title is revealed on long-press.
 */
export type SeriesCardMenuProps = {
  /** When false (no `bridgeId` — e.g. mock mode), render the card with no menu attached. */
  enabled: boolean;
  /** Full series title, shown unclamped in the lifted preview. */
  title: string;
  /** Cover URL, shown in the preview (falls back to an empty placeholder box when absent). */
  cover?: string;
  /** `null` while the status check is still loading — the action is disabled until it resolves. */
  favorited: boolean | null;
  inLibrary: boolean | null;
  onToggleFavorite: () => void;
  onToggleLibrary: () => void;
  children: React.ReactNode;
};

// Width of the lifted preview card. Roughly a grid card's width — enough for the cover to read and
// the title to wrap over a couple of lines, without the preview ballooning across the screen.
const PREVIEW_WIDTH = 200;

function PreviewCard({ title, cover }: { title: string; cover?: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.preview}>
      {cover ? (
        <Image source={{ uri: cover }} style={styles.previewCover} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.previewCover, styles.previewCoverEmpty]} />
      )}
      <ThemedText type="small" style={styles.previewTitle}>
        {title}
      </ThemedText>
    </ThemedView>
  );
}

export function SeriesCardMenu({
  enabled,
  title,
  cover,
  favorited,
  inLibrary,
  onToggleFavorite,
  onToggleLibrary,
  children,
}: SeriesCardMenuProps) {
  if (!enabled) return <>{children}</>;

  return (
    // Mirrors @expo/ui MenuView.ios's own hosting: `matchContents` sizes the SwiftUI host to the
    // card so layout is unchanged, and RN subtrees (trigger + preview) are bridged via RNHostView.
    <Host matchContents ignoreSafeArea="all">
      <ContextMenu>
        <ContextMenu.Trigger>
          <RNHostView matchContents>
            <>{children}</>
          </RNHostView>
        </ContextMenu.Trigger>
        <ContextMenu.Preview>
          <RNHostView matchContents>
            <PreviewCard title={title} cover={cover} />
          </RNHostView>
        </ContextMenu.Preview>
        <ContextMenu.Items>
          {/* Toggles (not plain Buttons) so iOS renders the current membership as a checkmark, matching
              the Android dropdown; the dynamic label states the action, `isOn` marks current state. */}
          <Toggle
            label={inLibrary ? 'Remove from Library' : 'Add to Library'}
            systemImage={inLibrary ? 'checkmark' : 'plus'}
            isOn={!!inLibrary}
            onIsOnChange={() => onToggleLibrary()}
            modifiers={inLibrary === null ? [disabledModifier(true)] : undefined}
          />
          <Toggle
            label={favorited ? 'Unfavorite' : 'Favorite'}
            systemImage={favorited ? 'star.fill' : 'star'}
            isOn={!!favorited}
            onIsOnChange={() => onToggleFavorite()}
            modifiers={favorited === null ? [disabledModifier(true)] : undefined}
          />
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}

const styles = StyleSheet.create({
  preview: {
    width: PREVIEW_WIDTH,
    padding: Spacing.two,
    gap: Spacing.two,
    borderRadius: 12,
  },
  previewCover: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 10,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  previewCoverEmpty: {
    backgroundColor: 'rgba(128,128,128,0.2)',
  },
  previewTitle: {
    fontWeight: '600',
  },
});
