import type { ReactNode } from 'react';

import { OptionList, useOverlay } from '@/components/overlay/overlay';
import {
  OptionMenu,
  OptionMenuButton,
  OptionRow,
  OptionSectionLabel,
} from '@/components/overlay/option-menu';

/**
 * One single-select axis of a `ChoiceMenuButton` — a sort, a direction, a grouping, a filter. Built
 * with `choiceSection` so the value, its options and its labels are checked against one type, then
 * erased to strings for the menu, which only ever compares and displays them.
 */
export type ChoiceSection = {
  /** Shown above the rows; omit for a menu that is one unlabelled list. */
  label?: string;
  /** Each row's testID is `${testID}.${value}`. */
  testID: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
};

export function choiceSection<T extends string>(
  section: Omit<ChoiceSection, 'options' | 'value' | 'onChange'> & {
    order: readonly T[];
    labels: Record<T, string>;
    value: T;
    onChange: (value: T) => void;
  },
): ChoiceSection {
  const { order, labels, onChange, ...rest } = section;
  return {
    ...rest,
    options: order.map((value) => ({ value, label: labels[value] })),
    onChange: (value) => onChange(value as T),
  };
}

/**
 * A bar icon whose menu is a stack of single-select axes — every sort, group and filter control on
 * the Library bar. Picking ANY row applies it and closes the menu, on every axis alike.
 *
 * That is a correctness rule as much as a consistency one: the overlay builds its content ONCE, when
 * it opens (see `OverlayProvider`), so a menu left open after a pick keeps showing the selection it
 * opened with — the check stays on the old row while the grid behind it has already changed. One
 * pick per opening is the only shape in which what the menu shows is always what's applied.
 */
export function ChoiceMenuButton({
  testID,
  accessibilityLabel,
  icon,
  badge,
  title,
  sections,
}: {
  testID: string;
  accessibilityLabel: string;
  icon: ReactNode;
  /** See `OptionMenuButton` — a non-default choice is narrowing what's shown. */
  badge?: boolean;
  /** The sheet's heading (a popover drops it — see `OptionMenu`). */
  title: string;
  sections: ChoiceSection[];
}) {
  return (
    <OptionMenuButton
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      icon={icon}
      badge={badge}
      render={() => <ChoiceMenu title={title} sections={sections} />}
      native={sections.map((section) => ({
        key: section.testID,
        title: section.label,
        items: section.options.map((option) => ({
          key: option.value,
          label: option.label,
          checked: option.value === section.value,
          onSelect: () => section.onChange(option.value),
        })),
      }))}
    />
  );
}

function ChoiceMenu({ title, sections }: { title: string; sections: ChoiceSection[] }) {
  const { closeTop } = useOverlay();
  return (
    <OptionMenu title={title}>
      {sections.map((section, i) => (
        <OptionList key={section.testID}>
          {section.label && <OptionSectionLabel divided={i > 0}>{section.label}</OptionSectionLabel>}
          {section.options.map((option) => (
            <OptionRow
              key={option.value}
              testID={`${section.testID}.${option.value}`}
              label={option.label}
              selected={option.value === section.value}
              onPress={() => {
                section.onChange(option.value);
                closeTop();
              }}
            />
          ))}
        </OptionList>
      ))}
    </OptionMenu>
  );
}
