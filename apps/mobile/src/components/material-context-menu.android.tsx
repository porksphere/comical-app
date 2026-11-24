import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { closeContextMenu, type ContextMenuRequest } from '@/components/context-menu-host';
import type { MenuRowSpec } from '@/components/context-menu-material';
import { MaterialMenu, MENU_EXIT_MS } from '@/components/material-menu';
import { hapticImpactLight, hapticImpactMedium } from '@/lib/haptics';

/**
 * Android's `ContextMenuHost` menu: Material's dropdown, hung from the point the request names.
 * Nothing is peeked under a held finger here: the menu opens, the finger lifts, and a row is
 * tapped, as an Android menu is used.
 */
export function MaterialContextMenu({ req, rows }: { req: ContextMenuRequest; rows: MenuRowSpec[] }) {
  const [expanded, setExpanded] = useState(true);
  const exit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fixed = req.anchor === 'fixed';
  useEffect(() => {
    (fixed ? hapticImpactLight : hapticImpactMedium)();
    return () => void (exit.current && clearTimeout(exit.current));
  }, [fixed]);
  const close = () => {
    setExpanded(false);
    exit.current ??= setTimeout(closeContextMenu, MENU_EXIT_MS);
  };
  return (
    <View pointerEvents="box-none" style={[styles.anchor, { left: req.x, top: req.y }]}>
      <MaterialMenu rows={rows} title={req.title} expanded={expanded} onClose={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    width: 1,
    height: 1,
  },
});
