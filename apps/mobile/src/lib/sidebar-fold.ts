/**
 * Which of a sidebar group's rows show while the rest are folded behind its More row.
 *
 * A group of installed bridges or collections can outgrow the sidebar, and one long group pushes
 * the others off it. So past `SIDEBAR_FOLD_AT` rows a group shows that many and a More row that
 * opens the rest. The selected row is always among the shown: folded away, the group would have
 * no selection to show for the page that is on screen.
 */
export const SIDEBAR_FOLD_AT = 6;

export type SidebarFold<T> = {
  rows: T[];
  /** How many rows More stands for; 0 when the group has no More row at all. */
  hidden: number;
};

export function foldSidebarRows<T>(rows: readonly T[], selected: number, open: boolean): SidebarFold<T> {
  // One row behind a More row is a row spent hiding a row.
  if (rows.length <= SIDEBAR_FOLD_AT + 1) return { rows: [...rows], hidden: 0 };
  const hidden = rows.length - SIDEBAR_FOLD_AT;
  if (open) return { rows: [...rows], hidden };
  if (selected < SIDEBAR_FOLD_AT) return { rows: rows.slice(0, SIDEBAR_FOLD_AT), hidden };
  return { rows: [...rows.slice(0, SIDEBAR_FOLD_AT - 1), rows[selected]!], hidden };
}
