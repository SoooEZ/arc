import { useRef } from "react";

/**
 * UI-only identities for rows whose data objects are replaced on every edit
 * (input parameters, Transform fields). Keying by index or length remounts the
 * row's editors and drops partial text (lesson F6); keying by these identities
 * keeps each editor with its row across edits, additions and removals.
 */
export function useRowIdentities<Row extends object>(prefix: string) {
  const identities = useRef(new WeakMap<Row, string>());
  const sequence = useRef(0);
  const identity = (row: Row) => {
    let id = identities.current.get(row);
    if (!id) {
      id = `${prefix}-${++sequence.current}`;
      identities.current.set(row, id);
    }
    return id;
  };
  /** The replacement object keeps the identity of the row it replaces. */
  const carry = (from: Row, to: Row) => {
    identities.current.set(to, identity(from));
    return to;
  };
  return { identity, carry };
}
