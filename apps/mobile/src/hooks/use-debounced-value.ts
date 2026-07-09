import { useEffect, useState } from 'react';

/**
 * Returns `value` delayed by `ms` — it only updates once the input has stopped changing for that
 * long. Used to feed a debounced string into a react-query key (react-query itself doesn't debounce)
 * so a live autocomplete fires one request per pause instead of one per keystroke.
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
