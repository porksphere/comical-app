import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SettingsIcon } from '@/components/icons/reader-icons';
import { OverlayHeading, useAnchoredOverlay } from '@/components/overlay/overlay';
import { ReaderSettingsFields } from '@/components/reader/reader-settings-fields';
import { useReaderSettingsForm } from '@/components/reader/reader-settings-form';
import { Spacing } from '@/constants/theme';

/** Gear button that opens reader settings in the app's shared overlay system — a
 *  near-full-width bottom sheet on mobile/narrow web, an anchored popover
 *  (matching Browse's filter buttons) on wide desktop web.
 *
 *  Rendered inline in the reader toolbar's trailing slot, so it inherits that
 *  bar's fade/auto-hide rather than positioning or animating itself.
 *
 *  SETTINGS ONLY. It used to carry a "This page", a "This chapter" and a "This series" block of
 *  collect actions as well, which made the gear the app's densest screen and put three different
 *  subjects behind one control that names none of them. Each of the three already has a home where
 *  its subject is the thing you are looking at: a page has the toolbar's own save button beside this
 *  gear (`CollectPageControl`); a chapter has its row's long-press menu on the series screen
 *  (`series.chapter-menu.collect`); a series has the series screen. Nothing was lost, and the sheet
 *  is now only the three things that actually change how the reader behaves. */
export function SettingsControl({
  seriesKey,
  onOpenChange,
}: {
  /** `bridgeId:seriesId` — what the per-series spread shift is stored against. */
  seriesKey: string | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const { ref, open } = useReaderSettingsOverlay(seriesKey, onOpenChange);
  return (
    <Pressable
      testID="reader.settings.open"
      ref={ref}
      hitSlop={12}
      onPress={open}
      style={styles.gear}
      accessibilityRole="button"
      accessibilityLabel="Reader settings">
      <SettingsIcon color="#fff" size={20} />
    </Pressable>
  );
}

/** The settings sheet behind any trigger: anchored to `ref` when the trigger is a view that can
 *  be measured (the gear above), a plain sheet when it is not. `onOpenChange` follows the sheet,
 *  for the reader to hold its chrome up while it is open. (iOS presents a system sheet of its own
 *  instead — the `.ios` sibling.) */
export function useReaderSettingsOverlay(seriesKey: string | null, onOpenChange?: (open: boolean) => void) {
  const { ref, openAt, isOpen } = useAnchoredOverlay();
  useEffect(() => {
    if (!isOpen || !onOpenChange) return;
    onOpenChange(true);
    return () => onOpenChange(false);
  }, [isOpen, onOpenChange]);
  const open = () => openAt(() => <ReaderSettingsBody seriesKey={seriesKey} />);
  return { ref, open };
}

/** The reader's settings (`useReaderSettingsForm`) inside the overlay (sheet or popover), drawn by
 *  `ReaderSettingsFields`.
 *  Note: the overlay panel follows the app's theme (`useTheme`), so under a
 *  light appearance it renders light while the reader keeps its own always-dark
 *  viewing surface — an intentional split, matching how media
 *  readers stay dark for immersion while their controls track the app theme.
 *  So every colour in here is the theme's: a hardcoded white was white on white. */
export function ReaderSettingsBody({ seriesKey }: { seriesKey: string | null }) {
  const fields = useReaderSettingsForm(seriesKey);
  return (
    <View style={styles.content}>
      <OverlayHeading>Reader settings</OverlayHeading>
      <ReaderSettingsFields fields={fields} />
    </View>
  );
}

const styles = StyleSheet.create({
  gear: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: Spacing.four,
  },
});
