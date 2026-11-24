import { useEffect, useRef, useState } from 'react';

/** How long Material's menu takes to fade out: what hosts it stays mounted until then. */
export const MENU_EXIT_MS = 150;

/**
 * The life of a Compose menu hung from a control: mounted when it is asked for, so the Compose
 * host costs nothing until then, and unmounted once its exit has played.
 */
export function useMenuMount() {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const exit = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (exit.current && clearTimeout(exit.current)), []);
  const show = () => {
    if (exit.current) clearTimeout(exit.current);
    setMounted(true);
    setExpanded(true);
  };
  const close = () => {
    setExpanded(false);
    exit.current = setTimeout(() => setMounted(false), MENU_EXIT_MS);
  };
  return { mounted, expanded, show, close };
}
