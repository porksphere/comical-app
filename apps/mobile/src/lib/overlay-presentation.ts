export type OverlayPresentationItem = {
  anchor?: unknown | null;
  popover?: boolean;
  dialog?: boolean;
};

export type OverlayPresentation = 'sheet' | 'popover' | 'dialog';

export function overlayPresentation(
  item: OverlayPresentationItem,
  isLargeScreen: boolean,
  isWeb: boolean,
): OverlayPresentation {
  if (item.dialog && isLargeScreen && isWeb) return 'dialog';
  if (item.anchor && (isLargeScreen || item.popover)) return 'popover';
  return 'sheet';
}

export function presentsAsPopover(item: OverlayPresentationItem, isLargeScreen: boolean): boolean {
  return !!item.anchor && (isLargeScreen || !!item.popover);
}

export function presentsAsDialog(
  item: OverlayPresentationItem,
  isLargeScreen: boolean,
  isWeb: boolean,
): boolean {
  return overlayPresentation(item, isLargeScreen, isWeb) === 'dialog';
}

export function topUsesWebOutsideClick(
  items: OverlayPresentationItem[],
  isLargeScreen: boolean,
  isWeb: boolean,
): boolean {
  const top = items[items.length - 1];
  return !!top && overlayPresentation(top, isLargeScreen, isWeb) === 'popover' && isWeb;
}
