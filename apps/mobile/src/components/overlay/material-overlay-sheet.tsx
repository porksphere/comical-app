import type { ReactNode } from 'react';

export type MaterialOverlaySheetProps = {
  id: number;
  /** The sheet is gone, however it went: takes the item out of the overlay stack. */
  onClosed: () => void;
  /** Hands the stack this sheet's closer, for `closeTop`. */
  register: (id: number, fn: () => void) => void;
  children: ReactNode;
};

/** Whether the overlay stack's sheets are Material's (material-overlay-sheet.android): then the
 *  stack draws none itself, and neither dims nor pushes the app back under one. */
export const MATERIAL_SHEETS: boolean = false;

export const MaterialOverlaySheet: (props: MaterialOverlaySheetProps) => ReactNode = () => null;
