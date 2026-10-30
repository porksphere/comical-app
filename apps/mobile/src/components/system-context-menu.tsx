import { observable, ObservableHint, type OpaqueObject } from '@legendapp/state';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import type { LiveMenuRows } from '@/components/context-menu-host';
import type { MenuRowSpec } from '@/components/context-menu-material';
import {
  setSystemMenu,
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
 */
export const SYSTEM_MENU = SystemContextMenuView !== null;

type Rows = MenuRowSpec[] | LiveMenuRows;
type SystemMenuRequest = { token: number; rows: Rows };

// Opaque: a request carries functions (`rows` may be one), which an observable would otherwise take
// for computeds and call.
const systemMenu$ = observable<OpaqueObject<SystemMenuRequest> | null>(null);

// The open menu's actions by row id. Outlives the request: UIKit runs a picked row as the menu
// goes, so it must still be here once the rows are not.
let actions: { token: number; byId: Map<string, () => void> } | null = null;
let sent: { token: number; json: string } | null = null;

// Long enough for a picked row's action to have run before the live rows it closes over unmount.
const RELEASE_MS = 1000;

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
      style={style}
      onMenuRequest={(e) => systemMenu$.set(ObservableHint.opaque({ token: e.nativeEvent.token, rows: rows() }))}
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

/** Root-mounted (see app/_layout.tsx): publishes the open system menu's rows, if any. */
export function SystemContextMenuHost() {
  const req = useSystemMenuRequest();
  if (!req) return null;
  if (typeof req.rows === 'function') return req.rows((rows) => <Publish token={req.token} rows={rows} />);
  return <Publish token={req.token} rows={req.rows} />;
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
  const lead = rows[0]?.primary ? 1 : 0;
  let tail = rows.length;
  while (tail > lead && rows[tail - 1]?.destructive) tail--;
  const sections = [nodes.slice(0, lead), nodes.slice(lead, tail), nodes.slice(tail)].filter((s) => s.length > 0);
  if (sections.length < 2) return nodes;
  return sections.map((children, i) => ({ id: `section.${i}`, title: '', inline: true, children }));
}

function rowNode(row: MenuRowSpec, id: string, byId: Map<string, () => void>): SystemMenuNode {
  if (row.submenu) {
    const spec = row.submenu();
    return {
      id: `menu.${id}`,
      title: row.label,
      symbol: row.symbol,
      children: spec.rows.map((sub, j) => {
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
