import { createContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ViewInstance } from 'react-native';

import { fieldKey, type SettingsFormSection } from '@/components/settings/settings-form';

/** How long the focused row stays marked once it is in view. */
export const FOCUS_MARK_MS = 2200;
/** The mark: the accent at this strength over the row. */
export const FOCUS_WASH = 0.14;

/** What a renderer's rows read of the focus: the focused key, whether it is still marked, and where
 *  the app's renderer is handed the row's view to measure. */
export type FocusRow = { focus?: string; marked: boolean; hold?: (view: ViewInstance | null) => void };

export const FocusRowContext = createContext<FocusRow>({ marked: false });

/**
 * The list's `focus` row (`SettingsListProps.focus`): brought into view once, the first time it is
 * among the rows (a list that arrives late still gets it), and marked for `FOCUS_MARK_MS`. Once
 * only, so a list that keeps changing under it (a download ticking) never pulls the screen back.
 */
export function useFocusRow(focus: string | undefined, sections: readonly SettingsFormSection[], bringIntoView: (key: string) => void): boolean {
  const present = !!focus && sections.some((s) => s.fields.some((f) => fieldKey(f) === focus));
  const [marked, setMarked] = useState(!!focus);
  const done = useRef(false);
  const arrive = useEffectEvent((key: string) => bringIntoView(key));
  useEffect(() => {
    if (!focus || !present || done.current) return;
    done.current = true;
    // A frame later: the row has only just been handed to the list, which can't scroll to it yet.
    // Neither timer is cleared when the row goes: cleared, the mark would never come off.
    setTimeout(() => arrive(focus), 0);
    setTimeout(() => setMarked(false), FOCUS_MARK_MS);
  }, [focus, present]);
  return marked;
}

/** `over` laid on `under` at `amount`, both `#rrggbb`: an opaque wash, for a surface that can't
 *  stack a translucent one over its own background. `under` where either isn't a hex colour. */
export function washHex(over: string, under: string, amount: number): string {
  const rgb = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null);
  const a = rgb(over);
  const b = rgb(under);
  if (!a || !b) return under;
  return `#${a.map((c, i) => Math.round(b[i] + (c - b[i]) * amount).toString(16).padStart(2, '0')).join('')}`;
}
