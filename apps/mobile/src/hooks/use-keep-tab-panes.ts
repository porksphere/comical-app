import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
const keepTabPanes$ = persisted$('comical:keepTabPanes', { enabled: true });

/** Whether a tab you leave keeps its panes open for when you come back — see `lib/pane-tab`.
 *  A `use`-prefixed wrapper, never a bare `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useKeepTabPanes(): boolean {
  return use$(keepTabPanes$.enabled) ?? true;
}

export function setKeepTabPanes(enabled: boolean): void {
  keepTabPanes$.enabled.set(enabled);
}
