import { createContext, use, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

/** A pull's three moments, `y` the finger's place down the window in points. */
export type PullTouch = {
  start: (y: number) => void;
  move: (y: number) => void;
  end: () => void;
};

type ScreenPull = {
  /** Takes the screen's pull, and gives back what takes it away again. */
  register: (pull: PullTouch) => () => void;
  touch: (phase: 'start' | 'move' | 'end', y: number) => void;
};

const ScreenPullContext = createContext<ScreenPull | null>(null);

/**
 * Joins a screen's list to its pull-to-refresh where the two can't meet through touch events:
 * on Android the list's native anchor reads the finger (`ScreenScrollMarker`), and the screen's
 * `usePullToRefresh` is what it moves. One per screen, beside `BarScrolledProvider`.
 */
export function ScreenPullProvider({ children }: { children: ReactNode }) {
  const pull = useRef<PullTouch | null>(null);
  const register = useCallback((next: PullTouch) => {
    pull.current = next;
    return () => {
      if (pull.current === next) pull.current = null;
    };
  }, []);
  const touch = useCallback((phase: 'start' | 'move' | 'end', y: number) => {
    const to = pull.current;
    if (!to) return;
    if (phase === 'start') to.start(y);
    else if (phase === 'move') to.move(y);
    else to.end();
  }, []);
  const value = useMemo(() => ({ register, touch }), [register, touch]);
  return <ScreenPullContext.Provider value={value}>{children}</ScreenPullContext.Provider>;
}

/** Hands the screen's list this pull while `pull` is given. */
export function useScreenPullSource(pull: PullTouch | null): void {
  const register = use(ScreenPullContext)?.register;
  useEffect(() => (pull && register ? register(pull) : undefined), [pull, register]);
}

/** What the list's anchor reports a finger to; undefined outside a screen. */
export function useScreenPullTouch(): ScreenPull['touch'] | undefined {
  return use(ScreenPullContext)?.touch;
}
