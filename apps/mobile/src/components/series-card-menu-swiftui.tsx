import { Button, ContextMenu, Host, Menu, RNHostView, Section, Toggle } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useWindowDimensions, View, type GestureResponderEvent } from 'react-native';

import type { MenuRowSpec } from '@/components/context-menu-material';
import { SeriesCardSystemMenuRows } from '@/components/series-card-actions-menu';
import type { SeriesCardMenuProps } from '@/components/series-card-menu';
import { SeriesCardPreview } from '@/components/series-card-preview';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = NonNullable<ComponentProps<typeof Button>['systemImage']>;

// How long a touch rests on a card before its rows and preview mount: longer than a tap, shorter
// than the hold that opens the menu, so a hold finds them there and a scroll never mounts them.
const ARM_MS = 200;
// A touch that travels this far before then is a scroll.
const ARM_SLOP = 10;
const PREVIEW_MAX_WIDTH = 360;
const PREVIEW_MARGIN = 12;

const noop = () => {};

/**
 * Developer A/B only (Settings › Developer, iOS): the series card menu as @expo/ui's SwiftUI
 * `ContextMenu`, the way the app drew it until July, to compare scrolling against the system menu
 * module (series-card-menu.ios.tsx). Each card mounts a SwiftUI host with two React Native hosts
 * in it, which is the cost being compared. Its rows and preview mount only once a touch has rested
 * on the card, so a scrolling grid runs no queries for it, and they stay until the card shows
 * another series.
 *
 * What it can't do that the system menu does: lift just the cover, since SwiftUI lifts the whole
 * card; open the series when the preview is tapped; or stop a hold's release from tapping, which
 * the card's `onLongPress` does here instead.
 */
export function SwiftUISeriesCardMenu({
  enabled,
  bridgeId,
  bridge,
  entry,
  direct,
  coverAspect,
  swiftUI,
  children,
}: SeriesCardMenuProps) {
  const [armedFor, setArmedFor] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const content = children({ onLongPress: enabled && bridgeId ? noop : undefined, hidden: false, menuOpen: false });
  if (!enabled || !bridgeId) return <>{content}</>;

  const armed = armedFor === entry.id;
  const cancelArm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const onTouchStart = (e: GestureResponderEvent) => {
    if (armed) return;
    cancelArm();
    origin.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    const id = entry.id;
    timer.current = setTimeout(() => setArmedFor(id), ARM_MS);
  };
  const onTouchMove = (e: GestureResponderEvent) => {
    if (!timer.current) return;
    const { pageX, pageY } = e.nativeEvent;
    if (Math.hypot(pageX - origin.current.x, pageY - origin.current.y) > ARM_SLOP) cancelArm();
  };

  return (
    <Host
      matchContents={{ vertical: true }}
      ignoreSafeArea="all"
      style={swiftUI?.width !== undefined ? { width: swiftUI.width } : undefined}>
      <ContextMenu>
        <ContextMenu.Trigger>
          <RNHostView matchContents={{ vertical: true }}>
            <View onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={cancelArm} onTouchCancel={cancelArm}>
              {content}
            </View>
          </RNHostView>
        </ContextMenu.Trigger>
        {/* Always present, so the menu keeps its SwiftUI identity when the preview fills in. */}
        <ContextMenu.Preview>
          <RNHostView matchContents>
            {armed ? (
              <Preview
                bridgeId={bridgeId}
                entry={entry}
                {...(direct !== undefined && { direct })}
                {...(coverAspect !== undefined && { coverAspect })}
              />
            ) : (
              <View />
            )}
          </RNHostView>
        </ContextMenu.Preview>
        <ContextMenu.Items>
          {armed && (
            <SeriesCardSystemMenuRows
              bridgeId={bridgeId}
              entry={entry}
              {...(bridge !== undefined && { bridge })}
              {...(direct !== undefined && { direct })}>
              {menuItems}
            </SeriesCardSystemMenuRows>
          )}
        </ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}

function Preview(props: ComponentProps<typeof SeriesCardPreview>) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth - 2 * PREVIEW_MARGIN, PREVIEW_MAX_WIDTH);
  return (
    <View style={{ width, backgroundColor: theme.background }}>
      <SeriesCardPreview {...props} />
    </View>
  );
}

/** The system menu's grouping: a leading primary row, the rest, then the trailing destructive ones. */
function groups<T extends { destructive?: boolean }>(items: T[], lead: number): T[][] {
  let tail = items.length;
  while (tail > lead && items[tail - 1]?.destructive) tail--;
  return [items.slice(0, lead), items.slice(lead, tail), items.slice(tail)].filter((g) => g.length > 0);
}

function menuItems(rows: MenuRowSpec[]) {
  return (
    <>
      {groups(rows, rows[0]?.primary ? 1 : 0).map((group, i) => (
        <Section key={i}>
          {group.map((row) => (
            <Item key={row.testID} row={row} />
          ))}
        </Section>
      ))}
    </>
  );
}

function Item({ row }: { row: MenuRowSpec }) {
  const symbol = row.symbol as SymbolName | undefined;
  if (row.submenu) {
    const spec = row.submenu();
    return (
      <Menu label={row.label} systemImage={symbol}>
        {groups(spec.rows, 0).map((group, i) => (
          <Section key={i}>
            {group.map((sub) =>
              sub.active !== undefined ? (
                <Toggle
                  key={sub.testID}
                  label={sub.label}
                  isOn={sub.active}
                  onIsOnChange={() => sub.onPress()}
                  modifiers={sub.loading ? [disabled(true)] : undefined}
                />
              ) : (
                <Button
                  key={sub.testID}
                  label={sub.label}
                  role={sub.destructive ? 'destructive' : undefined}
                  onPress={sub.onPress}
                  modifiers={sub.loading ? [disabled(true)] : undefined}
                />
              ),
            )}
          </Section>
        ))}
      </Menu>
    );
  }
  return (
    <Button
      label={row.label}
      systemImage={symbol}
      role={row.destructive ? 'destructive' : undefined}
      onPress={row.onPress}
      modifiers={row.loading || row.disabled ? [disabled(true)] : undefined}
    />
  );
}
