import { useState } from "react";

/**
 * The value from the render that last changed `key`. A value computed on every
 * render (a Map of node errors, a list of messages, the shown graph) keeps its
 * identity while its key, a serialization of what matters, is unchanged, so
 * memoized consumers see one object per content and an effect or memo can
 * list the value itself as a dependency. A changed key adopts the new value in
 * the same render (React's adjust-state-while-rendering pattern) at the cost
 * of one extra render of the caller, so the hook suits values whose key
 * changes rarely; a hot path, such as the canvas's card bounds on every drag
 * frame, derives its value from the key instead.
 */
export function useKeyedValue<T>(value: T, key: string): T {
  const [kept, setKept] = useState({ key, value });
  if (kept.key === key) return kept.value;
  setKept({ key, value });
  return value;
}
