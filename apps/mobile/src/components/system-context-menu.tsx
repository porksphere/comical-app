import { observable, ObservableHint, type OpaqueObject } from '@legendapp/state';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { ContextMenuHold, type LiveMenuRows } from '@/components/context-menu-host';
import type { MenuRowSpec } from '@/components/context-menu-material';
import {
  setSystemMenu,
  SystemContextMenuPreviewContent as PreviewContentView,
  SystemContextMenuPreviewSlot as PreviewSlotView,
  SystemContextMenuTarget as NativeTarget,
  SystemContextMenuView,
  type SystemMenuNode,
} from '../../modules/system-context-menu';

/**
 * The system context menu on iOS (the local module `modules/system-context-menu`): the held
 * content lifts and UIKit draws the menu, its rows the same `MenuRowSpec`s the custom hold menu
 * draws everywhere else. They are asked for when the hold begins and published from the root
 * host while that menu is up, so live rows run their queries for one open, never once per row
 * of a list, and the open menu updates in place as they resolve.
 *
 * UIKit has no bold row, so a leading `primary` row gets a section of its own, and trailing
 * `destructive` rows close the menu in one, the way the system's own menus group them.
 *
 * A menu with a `preview` grows the held content into it, drawn by the same host into one native
 * view kept out of the window, so a list of cards still mounts no preview of its own. UIKit's
 * preview takes no touches: tapping it is `onPreviewPress`.
 */
export const SYSTEM_MENU = SystemContextMenuView !== null;

type Rows = MenuRowSpec[] | LiveMenuRows;
type SystemMenuRequest = { token: number; rows: Rows; preview: (() => ReactNode) | undefined };

// Opaque: a request carries functions (`rows` may be one), which an observable would otherwise take
// for computeds and call.
const systemMenu$ = observable<OpaqueObject<SystemMenuRequest> | null>(null);

// The open menu's actions by row id. Outlives the request: UIKit runs a picked row as the menu
// goes, so it must still be here once the rows are not.
let actions: { token: number; byId: Map<string, () => void> } | null = null;
let sent: { token: number; json: string } | null = null;

// Long enough for a picked row's action to have run before the live rows it closes over unmount.
const RELEASE_MS = 1000;

// The preview's size until it has laid out, which it nearly always has by the time UIKit asks.
const PREVIEW_HEIGHT_ESTIMATE = 250;
const PREVIEW_MAX_WIDTH = 360;
const PREVIEW_MARGIN = 12;

function useSystemMenuRequest(): SystemMenuRequest | null {
  return useSyncExternalStore(
    (onStoreChange) => systemMenu$.onChange(onStoreChange),
    () => systemMenu$.peek(),
    () => systemMenu$.peek(),
  );
}

export function SystemContextMenu({
  enabled = true,
  title,
  rows,
  previewRadius,
  previewBackground,
  preview,
  onPreviewPress,
  style,
  children,
}: {
  enabled?: boolean;
  title?: string;
  /** Asked for each time the menu opens. */
  rows: () => Rows;
  previewRadius?: number;
  previewBackground?: ColorValue;
  /** What the held content grows into, drawn at the menu's width; rendered only while it is up. */
  preview?: () => ReactNode;
  onPreviewPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (!SystemContextMenuView) return <View style={style}>{children}</View>;
  return (
    <SystemContextMenuView
      enabled={enabled}
      title={title}
      previewRadius={previewRadius}
      previewBackground={previewBackground}
      preview={!!preview}
      style={style}
      onMenuRequest={(e) =>
        systemMenu$.set(ObservableHint.opaque({ token: e.nativeEvent.token, rows: rows(), preview }))
      }
      onMenuAction={(e) => {
        if (actions?.token === e.nativeEvent.token) actions.byId.get(e.nativeEvent.id)?.();
      }}
      onMenuClose={(e) => {
        const { token } = e.nativeEvent;
        setTimeout(() => {
          if (systemMenu$.peek()?.token === token) systemMenu$.set(null);
        }, RELEASE_MS);
      }}
      onPreviewPress={onPreviewPress && (() => onPreviewPress())}>
      {children}
    </SystemContextMenuView>
  );
}

/**
 * `node` as what lifts when the `SystemContextMenu` around it is held, rather than all of it, with
 * `radius` corners. A function rather than a component, so where there is no system menu it adds
 * nothing to the tree.
 */
export function liftTarget(node: ReactNode, radius?: number): ReactNode {
  return NativeTarget ? <NativeTarget radius={radius}>{node}</NativeTarget> : node;
}

type HoldMenuProps = {
  enabled?: boolean;
  rows: () => Rows;
  children: Parameters<typeof ContextMenuHold>[0]['children'];
};

function SystemHoldMenu({ enabled = true, rows, children }: HoldMenuProps) {
  return (
    <SystemContextMenu enabled={enabled} rows={rows}>
      {children({})}
    </SystemContextMenu>
  );
}

/**
 * A hold menu from one rows builder: the system's on iOS, the custom `ContextMenuHold` one
 * everywhere else, which it is rather than wraps. The system menu needs nothing from the held
 * Pressable, so there the render prop hands it no long-press handlers.
 */
export const HoldMenu: (props: HoldMenuProps) => ReactNode = SYSTEM_MENU ? SystemHoldMenu : ContextMenuHold;

/**
 * Root-mounted (see app/_layout.tsx): publishes the open system menu's rows, if any, and draws its
 * preview.
 */
export function SystemContextMenuHost() {
  const req = useSystemMenuRequest();
  return (
    <>
      {req &&
        (typeof req.rows === 'function' ? (
          req.rows((rows) => <Publish token={req.token} rows={rows} />)
        ) : (
          <Publish token={req.token} rows={req.rows} />
        ))}
      <PreviewSlot preview={req?.preview} />
    </>
  );
}

/** Its height is measured, kept between opens as the next one's estimate, and followed while up. */
function PreviewSlot({ preview }: { preview: (() => ReactNode) | undefined }) {
  const { width: windowWidth } = useWindowDimensions();
  const [height, setHeight] = useState(PREVIEW_HEIGHT_ESTIMATE);
  if (!PreviewSlotView || !PreviewContentView) return null;
  const width = Math.min(windowWidth - 2 * PREVIEW_MARGIN, PREVIEW_MAX_WIDTH);
  return (
    <PreviewSlotView style={styles.slot} pointerEvents="none">
      <PreviewContentView preferredWidth={width} preferredHeight={height} style={[styles.content, { width, height }]}>
        {preview ? (
          <View style={{ width }} onLayout={(e) => setHeight(Math.ceil(e.nativeEvent.layout.height))}>
            {preview()}
          </View>
        ) : null}
      </PreviewContentView>
    </PreviewSlotView>
  );
}

function Publish({ token, rows }: { token: number; rows: MenuRowSpec[] }) {
  useEffect(() => {
    const byId = new Map<string, () => void>();
    const nodes = menuNodes(rows, byId);
    const json = JSON.stringify(nodes);
    actions = { token, byId };
    if (sent?.token === token && sent.json === json) return;
    sent = { token, json };
    setSystemMenu(token, nodes);
  });
  return null;
}

function menuNodes(rows: MenuRowSpec[], byId: Map<string, () => void>): SystemMenuNode[] {
  const nodes = rows.map((row, i) => rowNode(row, String(i), byId));
  return sectioned(nodes, rows[0]?.primary ? 1 : 0, '');
}

/** `lead` rows, then the rest, then the trailing destructive rows, each an inline section. */
function sectioned(nodes: SystemMenuNode[], lead: number, prefix: string): SystemMenuNode[] {
  let tail = nodes.length;
  while (tail > lead && nodes[tail - 1]?.destructive) tail--;
  const sections = [nodes.slice(0, lead), nodes.slice(lead, tail), nodes.slice(tail)].filter((s) => s.length > 0);
  if (sections.length < 2) return nodes;
  return sections.map((children, i) => ({ id: `${prefix}section.${i}`, title: '', inline: true, children }));
}

function rowNode(row: MenuRowSpec, id: string, byId: Map<string, () => void>): SystemMenuNode {
  if (row.submenu) {
    const spec = row.submenu();
    return {
      id: `menu.${id}`,
      title: row.label,
      symbol: row.symbol,
      children: sectioned(
        spec.rows.map((sub, j) => {
          const subId = `${id}.${j}`;
          byId.set(subId, sub.onPress);
          return {
            id: subId,
            title: sub.label,
            on: !!sub.active,
            destructive: sub.destructive,
            disabled: sub.loading,
            // A membership toggle is one of several picks; anything else ends the menu.
            keepsOpen: sub.active !== undefined,
          };
        }),
        0,
        `${id}.`,
      ),
    };
  }
  byId.set(id, row.onPress);
  return {
    id,
    title: row.label,
    symbol: row.symbol,
    destructive: row.destructive,
    disabled: row.loading || row.disabled,
  };
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', width: 0, height: 0 },
  content: { position: 'absolute', top: 0, left: 0 },
});
