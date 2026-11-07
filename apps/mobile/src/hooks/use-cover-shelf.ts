import { use$ } from '@legendapp/state/react';

import { persisted$ } from '@/lib/observable';

/** Persisted as an OBJECT, not a bare boolean — see lib/dev-profiler-flag for why a bare `false`
 *  breaks Legend State's persistence. */
const coverShelf$ = persisted$('comical:coverShelf', { on: true });

/** Whether a row's covers stand on a common line, the way books sit on a shelf, rather than hang
 *  from its top (Settings → General; on unless turned off). A `use`-prefixed wrapper, never a bare
 *  `use$` at a call site — see `sidebar-bridges.tsx`. */
export function useCoverShelf(): boolean {
  return use$(coverShelf$.on) ?? true;
}

export function setCoverShelf(on: boolean): void {
  coverShelf$.on.set(on);
}
