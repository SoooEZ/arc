import { useEffect, useState } from "react";

/** Catalog searches wait this long after the last keystroke. */
export const searchDelayMs = 250;

/** `value` once it has stopped changing for `delayMs`, e.g. search text after typing pauses. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
