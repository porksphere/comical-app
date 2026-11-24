import { MaterialMenu } from '@/components/material-menu';
import type { MaterialOptionMenuProps } from '@/components/overlay/material-option-menu';

export const MATERIAL_OPTION_MENUS = true;

export function MaterialOptionMenu({ sections, expanded, onClose, staysOpen }: MaterialOptionMenuProps) {
  return (
    <MaterialMenu
      expanded={expanded}
      onClose={onClose}
      staysOpen={staysOpen}
      sections={sections.map((section) => ({
        label: section.label,
        rows: section.rows.map((row) => ({ testID: row.testID, label: row.label, active: row.selected, onPress: row.onPress })),
      }))}
    />
  );
}
