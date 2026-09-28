import { useRef } from "react";

/**
 * UI-only identities for rows whose data objects are replaced on every edit
 * (input parameters, Transform fields). Keying by index or length remounts the
 * row's editors and drops partial text (lesson F6); keying by these identities
 * keeps each editor with its row across edits, additions and removals.
 */
export function useRowIdentities<Row extends object>(
  prefix: string,
): RowIdentities<Row> {
  // One instance for the component's lifetime: row callbacks built from it
  // keep their identity, so memoized rows do not render for their siblings.
  const rows = useRef<RowIdentities<Row> | null>(null);
  rows.current ??= createRowIdentities(prefix);
  return rows.current;
}

export interface RowIdentities<Row extends object> {
  identity(row: Row): string;
  /** The replacement object keeps the identity of the row it replaces. */
  carry(from: Row, to: Row): Row;
}

function createRowIdentities<Row extends object>(
  prefix: string,
): RowIdentities<Row> {
  const identities = new WeakMap<Row, string>();
  let sequence = 0;
  const identity = (row: Row) => {
    let id = identities.get(row);
    if (!id) {
      id = `${prefix}-${++sequence}`;
      identities.set(row, id);
    }
    return id;
  };
  return {
    identity,
    carry(from, to) {
      identities.set(to, identity(from));
      return to;
    },
  };
}
