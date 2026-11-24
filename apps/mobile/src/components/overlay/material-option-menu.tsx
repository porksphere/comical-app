export type MaterialOptionRow = {
  testID: string;
  label: string;
  selected?: boolean;
  onPress: () => void;
};

export type MaterialOptionSection = {
  label?: string;
  rows: MaterialOptionRow[];
};

/** What a control hands the menu it hangs: `useMenuMount`'s state. */
export type MaterialMenuState = { expanded: boolean; onClose: () => void };

export type MaterialOptionMenuProps = MaterialMenuState & {
  sections: MaterialOptionSection[];
  /** A pick leaves the menu up: a checklist, where several rows are set in one visit. */
  staysOpen?: boolean;
};

/** Whether a bar control's short menu is Material's dropdown rather than the app's popover. */
export const MATERIAL_OPTION_MENUS: boolean = false;

/**
 * Android's renderer of an option menu: Material's dropdown, hung from the control it is mounted
 * inside, while `useMenuMount` has it mounted. Nothing elsewhere, where the overlay draws the menu.
 */
export function MaterialOptionMenu(_: MaterialOptionMenuProps) {
  return null;
}
