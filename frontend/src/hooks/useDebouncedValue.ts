import { useEffect, useState } from "react";

/** Catalog searches wait this long after the last keystroke. */
export const searchDelayMs = 250;
/**
 * A typeahead list (the `@` completion, the rule and source pickers) waits this
 * long: shorter than a catalog search, because the list is what the user is
 * looking at while typing.
 */
export const typeaheadDelayMs = 150;

/** `value` once it has stopped changing for `delayMs`, e.g. search text after typing pauses. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
