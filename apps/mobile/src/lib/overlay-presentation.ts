export type OverlayPresentationItem = {
  anchor?: unknown | null;
  popover?: boolean;
};

export function presentsAsPopover(item: OverlayPresentationItem, isLargeScreen: boolean): boolean {
  return !!item.anchor && (isLargeScreen || !!item.popover);
}

export function topUsesWebOutsideClick(
  items: OverlayPresentationItem[],
  isLargeScreen: boolean,
  isWeb: boolean,
): boolean {
  const top = items[items.length - 1];
  return isWeb && !!top && presentsAsPopover(top, isLargeScreen);
}
