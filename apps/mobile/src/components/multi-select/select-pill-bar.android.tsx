import {
  Box,
  FloatingActionButton,
  HorizontalFloatingToolbar,
  Icon,
  IconButton,
  Text,
  TextButton,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth, paddingAll, testID as testTag } from '@expo/ui/jetpack-compose/modifiers';
import { useRef } from 'react';
import { StyleSheet, View, type ViewInstance } from 'react-native';

import { openContextMenu } from '@/components/context-menu-host';
import { materialSymbol } from '@/components/icons/material-symbols';
import { MaterialHost } from '@/components/material-host';
import type { SelectPillBarProps, SelectVerb } from '@/components/multi-select/select-mode';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type { SelectPillBarProps } from '@/components/multi-select/select-mode';

const MORE = require('@/assets/material-symbols/more_vert.xml');
// Room round a lone button for its shadow, which the host's bounds would otherwise cut.
const SHADOW_ROOM = 8;

/**
 * Android's select mode: Material 3 Expressive's floating toolbar, centred over the bottom of the
 * list, holding the staging menu's ⋮ and every verb as an icon button. A lone verb is the
 * toolbar's floating action button, the one thing the selection is for; with no menu beside it,
 * it stands alone in the add button's corner, as the app's own pill does.
 */
export function SelectPillBar({ verbs, options, optionsTestID = 'select.options', right, bottom }: SelectPillBarProps) {
  const theme = useTheme();
  const anchor = useRef<ViewInstance>(null);
  const showOptions = !!options && options.length > 0;
  if (verbs.length === 0 && !showOptions) return null;
  const solo = verbs.length === 1 ? verbs[0] : undefined;
  const soloColors = solo?.color
    ? { container: solo.color, content: solo.color === theme.danger ? theme.dangerOn : theme.accentOn }
    : undefined;

  if (solo && !showOptions) {
    return (
      <View pointerEvents="box-none" style={[styles.corner, { right: right - SHADOW_ROOM, bottom: bottom - SHADOW_ROOM }]}>
        <MaterialHost matchContents>
          <FloatingActionButton
            onClick={solo.onPress}
            containerColor={soloColors?.container}
            modifiers={[paddingAll(SHADOW_ROOM), testTag(solo.testID)]}>
            <FloatingActionButton.Icon>
              <VerbIcon verb={solo} tint={soloColors?.content} />
            </FloatingActionButton.Icon>
          </FloatingActionButton>
        </MaterialHost>
      </View>
    );
  }

  // The menu hangs from the toolbar's leading end, where its ⋮ is. Compose lays the toolbar out,
  // so its width here is Material's metrics: 48dp a button and its padding, or the ⋮ alone
  // beside the 56dp action button.
  const toolbarWidth = solo ? 64 + Spacing.two + 56 : Spacing.three + 48 * (verbs.length + 1);
  const openOptions = () =>
    anchor.current?.measureInWindow((x, y, width) =>
      openContextMenu({ x: x + (width - toolbarWidth) / 2, y, anchor: 'fixed', rows: options! }),
    );
  return (
    <View ref={anchor} collapsable={false} pointerEvents="box-none" style={[styles.place, { bottom }]}>
      <MaterialHost matchContents={{ vertical: true }} style={styles.host}>
        <Box contentAlignment="center" modifiers={[fillMaxWidth(), paddingAll(SHADOW_ROOM)]}>
          <HorizontalFloatingToolbar
            variant={solo ? 'vibrant' : 'standard'}
            colors={
              soloColors ? { fabContainerColor: soloColors.container, fabContentColor: soloColors.content } : undefined
            }>
            {showOptions && (
              <IconButton onClick={openOptions} modifiers={[testTag(optionsTestID)]}>
                <Icon source={MORE} contentDescription="Selection options" />
              </IconButton>
            )}
            {!solo &&
              verbs.map((verb) =>
                materialSymbol(verb.symbol) ? (
                  <IconButton key={verb.key} onClick={verb.onPress} modifiers={[testTag(verb.testID)]}>
                    <VerbIcon verb={verb} tint={verb.color} />
                  </IconButton>
                ) : (
                  <TextButton key={verb.key} onClick={verb.onPress} modifiers={[testTag(verb.testID)]}>
                    <Text color={verb.color}>{verb.label}</Text>
                  </TextButton>
                ),
              )}
            {solo && (
              <HorizontalFloatingToolbar.FloatingActionButton onPress={solo.onPress}>
                <VerbIcon verb={solo} />
              </HorizontalFloatingToolbar.FloatingActionButton>
            )}
          </HorizontalFloatingToolbar>
        </Box>
      </MaterialHost>
    </View>
  );
}

// A verb with no symbol to its name falls back to a plus only where a button has to hold an icon.
function VerbIcon({ verb, tint }: { verb: SelectVerb; tint?: string }) {
  return <Icon source={materialSymbol(verb.symbol) ?? materialSymbol('plus')!} tint={tint} contentDescription={verb.label} />;
}

const styles = StyleSheet.create({
  corner: {
    position: 'absolute',
  },
  place: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  host: {
    width: '100%',
  },
});
