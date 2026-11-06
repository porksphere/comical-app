/**
 * `system-context-menu` — the system context menu (UIContextMenuInteraction) on content React
 * Native draws. Holding a `SystemContextMenuView` lifts its content, or the
 * `SystemContextMenuTarget` inside it, and opens a UIMenu whose rows are asked for only then:
 * `onMenuRequest` carries a token, `setSystemMenu` answers it, and a later answer under the same
 * token updates the open menu in place. With `preview`, the held content grows into the one
 * root-mounted `SystemContextMenuPreviewContent` instead of only lifting. `components/system-context-menu.tsx`
 * is the app's side.
 *
 * Null where the module isn't linked (Android, web, a build from before it existed).
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ColorValue, NativeSyntheticEvent, ViewProps } from 'react-native';

/** A row of the menu, or a submenu (an inline section with `inline`) when it has `children`. */
export type SystemMenuNode = {
  /** What `onMenuAction` reports for a row; a submenu's identity while it is open. */
  id?: string;
  title: string;
  subtitle?: string;
  /** An SF Symbol. */
  symbol?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Whether the row carries the checkmark. */
  on?: boolean;
  /** The menu stays up after the row is picked, for picks made several at a time. */
  keepsOpen?: boolean;
  inline?: boolean;
  children?: SystemMenuNode[];
};

type TokenEvent = NativeSyntheticEvent<{ token: number }>;

export type SystemContextMenuViewProps = ViewProps & {
  enabled?: boolean;
  /** The menu's heading, over its rows. */
  title?: string;
  /** The corners of the lifted content where no target inside names its own. */
  previewRadius?: number;
  /** Fills the lifted content behind what React Native draws; clear by default. */
  previewBackground?: ColorValue;
  /** The held content grows into the shared preview content rather than only lifting. */
  preview?: boolean;
  onMenuRequest?: (event: TokenEvent) => void;
  onMenuAction?: (event: NativeSyntheticEvent<{ token: number; id: string }>) => void;
  onMenuClose?: (event: TokenEvent) => void;
  /** The lifted content was tapped; the menu has closed. */
  onPreviewPress?: (event: TokenEvent) => void;
};

export type SystemContextMenuTargetProps = ViewProps & {
  /** The corners the lifted target is clipped to. */
  radius?: number;
};

export type SystemContextMenuPreviewContentProps = ViewProps & {
  /** The size the open preview takes, which follows changes while it is up. */
  preferredWidth: number;
  preferredHeight: number;
};

type NativeModule = { setMenu(token: number, json: string): void };

const native = requireOptionalNativeModule<NativeModule>('SystemContextMenu');

export const SystemContextMenuView: ComponentType<SystemContextMenuViewProps> | null = native
  ? requireNativeView<SystemContextMenuViewProps>('SystemContextMenu', 'SystemContextMenuView')
  : null;

export const SystemContextMenuTarget: ComponentType<SystemContextMenuTargetProps> | null = native
  ? requireNativeView<SystemContextMenuTargetProps>('SystemContextMenu', 'SystemContextMenuTargetView')
  : null;

/** Holds the preview content out of the window, for UIKit to show; mounted once, at the root. */
export const SystemContextMenuPreviewSlot: ComponentType<ViewProps> | null = native
  ? requireNativeView<ViewProps>('SystemContextMenu', 'SystemContextMenuPreviewSlotView')
  : null;

export const SystemContextMenuPreviewContent: ComponentType<SystemContextMenuPreviewContentProps> | null = native
  ? requireNativeView<SystemContextMenuPreviewContentProps>('SystemContextMenu', 'SystemContextMenuPreviewView')
  : null;

export function setSystemMenu(token: number, nodes: SystemMenuNode[]): void {
  native?.setMenu(token, JSON.stringify(nodes));
}
