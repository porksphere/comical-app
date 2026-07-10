import { Image } from 'expo-image';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { ContextMenu, Host, RNHostView, Toggle } from '@expo/ui/swift-ui';
import { disabled as disabledModifier } from '@expo/ui/swift-ui/modifiers';

import { SeriesCardMenuStatus, useCardMenuStatus } from '@/components/series-card-menu-status';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { SeriesEntry } from '@/data/types';
import { DEFAULT_THUMB_ASPECT } from '@/lib/aspect-ratio';

// TEMPORARY DIAGNOSTIC (2026-07-10): the per-card SwiftUI Host + ContextMenu is the prime suspect for
// the remaining iOS scroll lag — a native context-menu host mounted for every grid cell. With this
// true, cards render with NO native menu, so we can A/B scrolling on-device against the same build's
// previous behavior. If scrolling is smooth with this on, the host is confirmed as the cost and the
// real fix is a single shared long-press menu (which trades away the lifted preview). Then set false.
const DISABLE_NATIVE_CARD_MENU = true;

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
  /** True once the user has engaged this card (press-in). Gates the status queries. */
  armed: boolean;
  bridgeId?: string;
  entry: SeriesEntry;
  /** The cover's real (capped) aspect ratio, so the preview shows the cover at its true shape rather
   *  than a forced 2:3. Falls back to the 2:3 default until the cover has loaded. */
  coverAspect?: number;
  children: React.ReactNode;
};

function PreviewCard({ title, cover, coverAspect }: { title: string; cover?: string; coverAspect?: number }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const aspect = coverAspect ?? DEFAULT_THUMB_ASPECT; // width / height
  // Size the cover by fitting its real shape into a generous, responsive box at maximum size rather
  // than pinning the width — so a tall portrait grows to the height cap and a wide landscape grows to
  // the width cap (it no longer stays short because the width was fixed). The lift feels bigger overall
  // while never overflowing the screen (the caps leave margin for the frame padding + title).
  const maxW = Math.min(winW * 0.74, 340);
  const maxH = Math.min(winH * 0.5, 440);
  let coverW = maxW;
  let coverH = coverW / aspect;
  if (coverH > maxH) {
    coverH = maxH;
    coverW = coverH * aspect;
  }
  const coverSize = { width: coverW, height: coverH };
  return (
    <ThemedView type="backgroundElement" style={styles.preview}>
      {cover ? (
        <Image source={{ uri: cover }} style={[styles.previewCover, coverSize]} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.previewCover, styles.previewCoverEmpty, coverSize]} />
      )}
      <ThemedText type="small" style={[styles.previewTitle, { width: coverW }]}>
        {title}
      </ThemedText>
    </ThemedView>
  );
}

export function SeriesCardMenu({ enabled, armed, bridgeId, entry, coverAspect, children }: SeriesCardMenuProps) {
  const { status, togglesRef, onStatus } = useCardMenuStatus();

  // Diagnostic: render the bare card with no SwiftUI context-menu host. See the flag's comment above.
  // (Hook above still runs — it's just useState/useRef, so hook order stays valid — but nothing mounts.)
  if (DISABLE_NATIVE_CARD_MENU || !enabled) return <>{children}</>;

  return (
    <>
      {/* Renders nothing; runs the status queries only once the card is armed (see status module). */}
      {armed && bridgeId && (
        <SeriesCardMenuStatus bridgeId={bridgeId} entry={entry} onStatus={onStatus} togglesRef={togglesRef} />
      )}
      {/* Mirrors @expo/ui MenuView.ios's own hosting: `matchContents` sizes the SwiftUI host to the
          card so layout is unchanged, and RN subtrees (trigger + preview) are bridged via RNHostView. */}
      <Host matchContents ignoreSafeArea="all">
        <ContextMenu>
          <ContextMenu.Trigger>
            <RNHostView matchContents>
              <>{children}</>
            </RNHostView>
          </ContextMenu.Trigger>
          <ContextMenu.Preview>
            <RNHostView matchContents>
              <PreviewCard title={entry.title} cover={entry.cover} coverAspect={coverAspect} />
            </RNHostView>
          </ContextMenu.Preview>
          <ContextMenu.Items>
            {/* Toggles (not plain Buttons) so iOS renders the current membership as a checkmark, matching
                the Android dropdown; the dynamic label states the action, `isOn` marks current state. */}
            <Toggle
              label={status.inLibrary ? 'Remove from Library' : 'Add to Library'}
              systemImage={status.inLibrary ? 'checkmark' : 'plus'}
              isOn={!!status.inLibrary}
              onIsOnChange={() => togglesRef.current.library()}
              modifiers={status.inLibrary === null ? [disabledModifier(true)] : undefined}
            />
            <Toggle
              label={status.favorited ? 'Unfavorite' : 'Favorite'}
              systemImage={status.favorited ? 'star.fill' : 'star'}
              isOn={!!status.favorited}
              onIsOnChange={() => togglesRef.current.favorite()}
              modifiers={status.favorited === null ? [disabledModifier(true)] : undefined}
            />
          </ContextMenu.Items>
        </ContextMenu>
      </Host>
    </>
  );
}

const styles = StyleSheet.create({
  preview: {
    // No fixed width — the frame hugs the (inline-sized) cover, so it fits both tall and wide covers.
    // A generous, even frame around the cover + title so the background reads as a proper card
    // rather than a thin strip hugging the content.
    alignSelf: 'flex-start',
    padding: Spacing.three,
    gap: Spacing.three,
    borderRadius: 18,
  },
  previewCover: {
    // width/height are set inline from the cover's real (capped) shape, fit into a responsive box.
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
